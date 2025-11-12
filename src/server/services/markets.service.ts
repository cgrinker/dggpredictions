import type {
  Bet,
  BetId,
  BetSide,
  Market,
  MarketId,
  MarketStatus,
  Points,
  SubredditId,
  UserBalance,
  UserId,
} from '../../shared/types/entities.js';
import type { MarketDetail, MarketSummary, PaginatedResponse } from '../../shared/types/dto.js';
import type { ModeratorActionType } from '../../shared/types/moderation.js';
import { MarketRepository } from '../repositories/market.repository.js';
import { BetRepository } from '../repositories/bet.repository.js';
import { ConfigService } from './config.service.js';
import { BalanceRepository } from '../repositories/balance.repository.js';
import { LedgerService } from './ledger.service.js';
import { SchedulerService } from './scheduler.service.js';
import { AuditLogService } from './audit-log.service.js';
import { createMarketId } from '../utils/id.js';
import { nowIso } from '../utils/time.js';
import type { CreateMarketRequest } from '../../shared/types/dto.js';
import { NotFoundError, ValidationError } from '../errors.js';
import type { TxClientLike, RedisClient } from '@devvit/redis';
import { balanceKeys, betKeys, marketKeys, userKeys } from '../utils/redis-keys.js';
import { runTransactionWithRetry } from '../utils/transactions.js';
import { deserializeBet, deserializeMarket, deserializeUserBalance } from '../utils/serializers.js';

interface MarketSettlementResult {
  readonly market: Market;
  readonly totals: {
    readonly settledBets: number;
    readonly winners: number;
    readonly refunded: number;
    readonly totalPayout: Points;
  };
}

interface SettlementState {
  readonly market: Market;
  readonly bets: readonly Bet[];
  readonly balances: Map<UserId, UserBalance>;
}

type ResolveSettlementParams = {
  readonly mode: 'resolve';
  readonly resolution: BetSide;
  readonly moderatorId?: UserId | null;
  readonly moderatorUsername?: string | null;
  readonly notes?: string;
};

type VoidSettlementParams = {
  readonly mode: 'void';
  readonly moderatorId?: UserId | null;
  readonly moderatorUsername?: string | null;
  readonly reason: string;
};

type SettlementParams = ResolveSettlementParams | VoidSettlementParams;

type PublishMarketOptions = {
  readonly moderatorId?: UserId | null;
  readonly moderatorUsername?: string | null;
  readonly autoCloseOverrideMinutes?: number | null;
};

type CloseMarketOptions = {
  readonly moderatorId?: UserId | null;
  readonly moderatorUsername?: string | null;
};

type CloseMarketInternalOptions = {
  readonly moderatorId?: UserId | null;
  readonly moderatorUsername?: string | null;
  readonly auto: boolean;
};

interface AutoCloseResult {
  readonly status: 'closed' | 'skipped';
  readonly market?: Market;
  readonly reason?: string;
}

interface ArchiveMarketsOptions {
  readonly cutoff: Date;
  readonly statuses?: ReadonlyArray<MarketStatus>;
  readonly moderatorId?: UserId | null;
  readonly maxMarkets?: number;
  readonly dryRun?: boolean;
  readonly page?: number;
  readonly pageSize?: number;
}

interface ArchiveMarketsResult {
  readonly processedMarkets: number;
  readonly archivedMarkets: number;
  readonly skippedMarkets: number;
  readonly cutoffIso: string;
  readonly dryRun: boolean;
  readonly candidates: readonly MarketSummary[];
  readonly pagination: {
    readonly page: number;
    readonly pageSize: number;
    readonly total: number;
  };
}

interface ListMarketsOptions {
  readonly status?: MarketStatus;
  readonly page?: number;
  readonly pageSize?: number;
}

export class MarketsService {
  private readonly markets: MarketRepository;
  private readonly bets: BetRepository;
  private readonly balances: BalanceRepository;
  private readonly ledger: LedgerService;
  private readonly scheduler: SchedulerService;
  private readonly config: ConfigService;
  private readonly audit: AuditLogService;

  constructor(
    markets = new MarketRepository(),
    bets = new BetRepository(),
    balances = new BalanceRepository(),
    ledger = new LedgerService(),
    scheduler = new SchedulerService(),
    config = new ConfigService(),
    audit = new AuditLogService(),
  ) {
    this.markets = markets;
    this.bets = bets;
    this.balances = balances;
    this.ledger = ledger;
    this.scheduler = scheduler;
    this.config = config;
    this.audit = audit;
  }

  async list(
    subredditId: SubredditId,
    options?: ListMarketsOptions,
    userId?: UserId | null,
  ): Promise<PaginatedResponse<MarketSummary>> {
    const { markets, total } = await this.markets.list(subredditId, options);

    void userId; // reserved for future personalization

    const data = markets.map((market) => this.toMarketSummary(market));

    return {
      data,
      pagination: {
        page: options?.page ?? 1,
        pageSize: options?.pageSize ?? markets.length,
        total,
      },
    } satisfies PaginatedResponse<MarketSummary>;
  }

  async getDetail(
    subredditId: SubredditId,
    marketId: MarketId,
    userId?: UserId | null,
  ): Promise<MarketDetail> {
    const market = await this.markets.getById(subredditId, marketId);
    if (!market) {
      throw new NotFoundError(`Market ${marketId} not found.`);
    }

    const userBet = userId ? await this.findUserBet(subredditId, marketId, userId) : null;
    return { ...market, userBet } satisfies MarketDetail;
  }

  async createDraft(
    subredditId: SubredditId,
    creatorId: UserId,
    payload: CreateMarketRequest,
    options?: { readonly creatorUsername?: string | null },
  ): Promise<Market> {
    this.ensureCloseTimeIsValid(payload.closesAt);
    const config = await this.config.getConfig(subredditId);

    if (config.maxOpenMarkets !== null) {
      const existingOpen = await this.markets.list(subredditId, { status: 'open' });
      if (existingOpen.total >= config.maxOpenMarkets) {
        throw new ValidationError('Maximum number of open markets reached.');
      }
    }

    const metadata = payload.tags && payload.tags.length > 0 ? { tags: payload.tags } : undefined;
    const base: Omit<Market, 'metadata'> & { metadata?: Record<string, unknown> } = {
      schemaVersion: 1,
      id: createMarketId(),
      subredditId,
      title: payload.title,
      description: payload.description,
      createdBy: creatorId,
      createdAt: nowIso(),
      closesAt: payload.closesAt,
      resolvedAt: null,
      status: 'draft',
      resolution: null,
      potYes: 0,
      potNo: 0,
      totalBets: 0,
    };

    if (metadata) {
      base.metadata = metadata;
    }

    const market: Market = base;

    await this.markets.create(subredditId, market);

    await this.recordMarketAction(subredditId, {
      moderatorId: creatorId,
      moderatorUsername: options?.creatorUsername ?? null,
      action: 'CREATE_MARKET',
      marketId: market.id,
      payload: {
        title: payload.title,
        closesAt: payload.closesAt,
        tags: payload.tags ?? [],
      },
    });
    return market;
  }

  async resolveMarket(
    subredditId: SubredditId,
    marketId: MarketId,
    resolution: BetSide,
    options?: { moderatorId?: UserId | null; moderatorUsername?: string | null; notes?: string },
  ): Promise<MarketSettlementResult> {
    const market = await this.markets.getById(subredditId, marketId);
    if (!market) {
      throw new NotFoundError(`Market ${marketId} not found.`);
    }

    if (market.status === 'resolved') {
      throw new ValidationError('Market is already resolved.');
    }

    if (market.status === 'void') {
      throw new ValidationError('Voided markets cannot be resolved.');
    }

    if (market.status !== 'closed') {
      throw new ValidationError('Market must be closed before it can be resolved.');
    }

    const bets = await this.bets.listByMarket(subredditId, marketId);
    const settlementParams: ResolveSettlementParams = {
      mode: 'resolve',
      resolution,
      ...(options?.moderatorId !== undefined ? { moderatorId: options.moderatorId } : {}),
      ...(options?.moderatorUsername !== undefined
        ? { moderatorUsername: options.moderatorUsername }
        : {}),
      ...(options?.notes !== undefined ? { notes: options.notes } : {}),
    };

    const result = await this.settleMarket(subredditId, market, bets, settlementParams);

    await this.recordMarketAction(subredditId, {
      moderatorId: options?.moderatorId ?? null,
      moderatorUsername: options?.moderatorUsername ?? null,
      action: 'RESOLVE_MARKET',
      marketId,
      payload: {
        resolution,
        ...(options?.notes ? { notes: options.notes } : {}),
        totals: result.totals,
      },
    });

    return result;
  }

  async voidMarket(
    subredditId: SubredditId,
    marketId: MarketId,
    reason: string,
    options?: { moderatorId?: UserId | null; moderatorUsername?: string | null },
  ): Promise<MarketSettlementResult> {
    const market = await this.markets.getById(subredditId, marketId);
    if (!market) {
      throw new NotFoundError(`Market ${marketId} not found.`);
    }

    if (market.status === 'resolved') {
      throw new ValidationError('Resolved markets cannot be voided.');
    }

    if (market.status === 'void') {
      throw new ValidationError('Market is already void.');
    }

    if (market.status !== 'open' && market.status !== 'closed') {
      throw new ValidationError('Only open or closed markets can be voided.');
    }

    const bets = await this.bets.listByMarket(subredditId, marketId);
    const settlementParams: VoidSettlementParams = {
      mode: 'void',
      reason,
      ...(options?.moderatorId !== undefined ? { moderatorId: options.moderatorId } : {}),
      ...(options?.moderatorUsername !== undefined
        ? { moderatorUsername: options.moderatorUsername }
        : {}),
    };

    const result = await this.settleMarket(subredditId, market, bets, settlementParams);

    await this.recordMarketAction(subredditId, {
      moderatorId: options?.moderatorId ?? null,
      moderatorUsername: options?.moderatorUsername ?? null,
      action: 'VOID_MARKET',
      marketId,
      payload: { reason },
    });

    return result;
  }

  async publishMarket(
    subredditId: SubredditId,
    marketId: MarketId,
    options?: PublishMarketOptions,
  ): Promise<Market> {
    const market = await this.markets.getById(subredditId, marketId);
    if (!market) {
      throw new NotFoundError(`Market ${marketId} not found.`);
    }

    if (market.status !== 'draft') {
      throw new ValidationError('Only draft markets can be published.');
    }

    this.ensureCloseTimeIsValid(market.closesAt);

    const config = await this.config.getConfig(subredditId);
    const timestamp = nowIso();

    const metadataPatch: Record<string, unknown> = {
      publishedBy: options?.moderatorId ?? undefined,
      publishedByUsername: options?.moderatorUsername ?? undefined,
      lastPublishedAt: timestamp,
    };

    const overrideMinutes = this.normalizeAutoCloseOverride(options?.autoCloseOverrideMinutes);
    if (overrideMinutes !== undefined) {
      metadataPatch.autoCloseOverrideMinutes = overrideMinutes;
    }

    await this.scheduler.cancelMarketClose(subredditId, marketId);

    const updated = this.applyMarketPatch(
      market,
      {
        status: 'open',
        resolvedAt: null,
        resolution: null,
      },
      metadataPatch,
    );

    const saved = await this.markets.save(subredditId, updated);

    const runAt = this.calculateAutoCloseTime(
      saved.closesAt,
      overrideMinutes !== undefined ? overrideMinutes : config.autoCloseGraceMinutes,
    );
    if (runAt) {
      await this.scheduler.scheduleMarketClose(subredditId, marketId, { runAt });
    }

    await this.recordMarketAction(subredditId, {
      moderatorId: options?.moderatorId ?? null,
      moderatorUsername: options?.moderatorUsername ?? null,
      action: 'PUBLISH_MARKET',
      marketId,
      payload: {
        autoCloseOverrideMinutes:
          overrideMinutes !== undefined ? overrideMinutes : config.autoCloseGraceMinutes,
        ...(overrideMinutes === null ? { autoCloseDisabled: true } : {}),
      },
    });

    return saved;
  }

  async closeMarket(
    subredditId: SubredditId,
    marketId: MarketId,
    options?: CloseMarketOptions,
  ): Promise<Market> {
    const market = await this.markets.getById(subredditId, marketId);
    if (!market) {
      throw new NotFoundError(`Market ${marketId} not found.`);
    }

    if (market.status !== 'open') {
      throw new ValidationError('Only open markets can be closed.');
    }
    const internalOptions: CloseMarketInternalOptions =
      options && 'moderatorId' in options
        ? {
            auto: false,
            moderatorId: options.moderatorId ?? null,
            moderatorUsername: options.moderatorUsername ?? null,
          }
        : { auto: false, moderatorId: null, moderatorUsername: null };

    const updated = await this.closeMarketInternal(subredditId, market, internalOptions);

    await this.recordMarketAction(subredditId, {
      moderatorId: options?.moderatorId ?? null,
      moderatorUsername: options?.moderatorUsername ?? null,
      action: 'CLOSE_MARKET',
      marketId,
      payload: { mode: 'manual' },
    });

    return updated;
  }

  async autoCloseMarket(subredditId: SubredditId, marketId: MarketId): Promise<AutoCloseResult> {
    const market = await this.markets.getById(subredditId, marketId);
    if (!market) {
      await this.scheduler.cancelMarketClose(subredditId, marketId);
      return { status: 'skipped', reason: 'not_found' } satisfies AutoCloseResult;
    }

    if (market.status !== 'open') {
      await this.scheduler.cancelMarketClose(subredditId, marketId);
      return {
        status: 'skipped',
        reason: `market_status_${market.status}`,
        market,
      } satisfies AutoCloseResult;
    }

    const closed = await this.closeMarketInternal(subredditId, market, {
      auto: true,
      moderatorId: null,
      moderatorUsername: null,
    });
    return { status: 'closed', market: closed } satisfies AutoCloseResult;
  }

  async archiveMarkets(subredditId: SubredditId, options: ArchiveMarketsOptions): Promise<ArchiveMarketsResult> {
    const statuses = this.normalizeArchivableStatuses(options.statuses);
    if (statuses.length === 0) {
      throw new ValidationError('No archivable statuses provided.');
    }

    const cutoffMillis = options.cutoff.getTime();
    const maxArchives = options.maxMarkets ?? Number.POSITIVE_INFINITY;
    const page = Math.max(1, options.page ?? 1);
    const pageSize = Math.max(1, Math.min(500, options.pageSize ?? 50));
    const pageStartIndex = (page - 1) * pageSize;
    const candidateSummaries: MarketSummary[] = [];

    let archivedCount = 0;
    let processedCount = 0;
    let skippedCount = 0;
    let eligibleCount = 0;

    const shouldLimit = Number.isFinite(maxArchives);
    const maxCount = shouldLimit ? Number(maxArchives) : Number.POSITIVE_INFINITY;

    let stopProcessing = false;

    for (const status of statuses) {
      if (stopProcessing) {
        break;
      }

      let statusPage = 1;
      const chunkSize = shouldLimit
        ? Math.max(1, Math.min(200, Math.ceil(maxCount - archivedCount)))
        : 200;

      while (!stopProcessing) {
        const { markets } = await this.markets.list(subredditId, {
          status,
          page: statusPage,
          pageSize: chunkSize,
        });

        if (markets.length === 0) {
          break;
        }

        for (const market of markets) {
          if (archivedCount >= maxCount) {
            stopProcessing = true;
            break;
          }

          processedCount += 1;

          const lifecycleTimestamp = this.getLifecycleTimestamp(market);
          if (lifecycleTimestamp === null || lifecycleTimestamp > cutoffMillis) {
            skippedCount += 1;
            continue;
          }

          if (this.isAlreadyArchived(market)) {
            skippedCount += 1;
            continue;
          }

          if (eligibleCount >= pageStartIndex && candidateSummaries.length < pageSize) {
            candidateSummaries.push(this.toMarketSummary(market));
          }

          eligibleCount += 1;

          if (options.dryRun) {
            archivedCount += 1;
            continue;
          }

          const bets = await this.bets.listByMarket(subredditId, market.id);
          await this.archiveMarketData(subredditId, market, bets, {
            moderatorId: options.moderatorId ?? null,
          });
          archivedCount += 1;
        }

        if (!stopProcessing && archivedCount >= maxCount) {
          stopProcessing = true;
        }

        if (stopProcessing) {
          break;
        }

        if (markets.length < chunkSize) {
          break;
        }

        statusPage += 1;
      }
    }

    return {
      processedMarkets: processedCount,
      archivedMarkets: archivedCount,
      skippedMarkets: skippedCount,
      cutoffIso: options.cutoff.toISOString(),
      dryRun: Boolean(options.dryRun),
      candidates: candidateSummaries,
      pagination: {
        page,
        pageSize,
        total: eligibleCount,
      },
    } satisfies ArchiveMarketsResult;
  }

  private ensureCloseTimeIsValid(raw: string) {
    const closesAt = Date.parse(raw);
    if (Number.isNaN(closesAt)) {
      throw new ValidationError('closesAt must be an ISO-8601 timestamp.');
    }

    if (closesAt <= Date.now()) {
      throw new ValidationError('closesAt must be in the future.');
    }
  }

  private async findUserBet(
    subredditId: SubredditId,
    marketId: MarketId,
    userId: UserId,
  ): Promise<Bet | null> {
    const pointer = await this.markets.getUserBetPointer(subredditId, marketId, userId);
    if (!pointer) {
      return null;
    }

    return this.bets.getById(subredditId, pointer);
  }

  private toMarketSummary(market: Market): MarketSummary {
    const impliedYesPayout = this.calculateImpliedPayout(market.potYes, market.potNo);
    const impliedNoPayout = this.calculateImpliedPayout(market.potNo, market.potYes);

    return {
      id: market.id,
      title: market.title,
      status: market.status,
      closesAt: market.closesAt,
      potYes: market.potYes,
      potNo: market.potNo,
      totalBets: market.totalBets,
      impliedYesPayout,
      impliedNoPayout,
      ...(market.metadata ? { metadata: market.metadata } : {}),
    } satisfies MarketSummary;
  }

  private calculateImpliedPayout(potFor: number, potAgainst: number): number {
    const sanitizedFor = potFor > 0 ? potFor : 1;
    const totalPool = potFor + potAgainst;
    if (totalPool === 0) {
      return 1;
    }

    const odds = potAgainst / sanitizedFor;
    return Number.parseFloat((1 + odds).toFixed(2));
  }

  private async recordMarketAction(
    subredditId: SubredditId,
    details: {
      readonly moderatorId: UserId | null | undefined;
      readonly moderatorUsername: string | null | undefined;
      readonly action: ModeratorActionType;
      readonly marketId: MarketId;
      readonly payload?: Record<string, unknown>;
    },
  ): Promise<void> {
    if (!details.moderatorId) {
      return;
    }

    await this.audit.recordAction(subredditId, {
      performedBy: details.moderatorId,
      performedByUsername: details.moderatorUsername ?? 'unknown',
      action: details.action,
      marketId: details.marketId,
      payload: details.payload ?? {},
    });
  }

  private async settleMarket(
    subredditId: SubredditId,
    market: Market,
    bets: readonly Bet[],
    params: SettlementParams,
  ): Promise<MarketSettlementResult> {
    const activeBets = bets.filter((bet) => bet.status === 'active');
    const betIds = activeBets.map((bet) => bet.id);
    const userIds = Array.from(new Set(activeBets.map((bet) => bet.userId)));

    const watchKeys = new Set<string>();
    watchKeys.add(marketKeys.record(subredditId, market.id));
    watchKeys.add(marketKeys.betsIndex(subredditId, market.id));
    betIds.forEach((betId) => watchKeys.add(betKeys.record(subredditId, betId)));
    userIds.forEach((userId) => {
      watchKeys.add(balanceKeys.record(subredditId, userId));
      watchKeys.add(marketKeys.userPointer(subredditId, market.id, userId));
    });

    const keys = Array.from(watchKeys);
    const label = `market:settle:${params.mode}`;

    const result = await runTransactionWithRetry<MarketSettlementResult, SettlementState>(
      keys,
      async (tx, state) => this.applySettlement(tx, subredditId, params, state),
      {
        label,
        loadState: async (client) =>
          this.loadSettlementState(client, subredditId, market.id, betIds, userIds),
      },
    );

    return result;
  }

  private async loadSettlementState(
    client: RedisClient,
    subredditId: SubredditId,
    marketId: MarketId,
    betIds: readonly BetId[],
    userIds: readonly UserId[],
  ): Promise<SettlementState> {
    const marketKey = marketKeys.record(subredditId, marketId);
    const marketHash = await client.hGetAll(marketKey);
    const market = deserializeMarket(marketHash);
    if (!market) {
      throw new NotFoundError(`Market ${marketId} not found.`);
    }

    const bets = await Promise.all(
      betIds.map(async (betId) => {
        const betHash = await client.hGetAll(betKeys.record(subredditId, betId));
        const bet = deserializeBet(betHash);
        if (!bet) {
          throw new NotFoundError(`Bet ${betId} not found for settlement.`);
        }
        return bet;
      }),
    );

    const balances = new Map<UserId, UserBalance>();
    await Promise.all(
      userIds.map(async (userId) => {
        const balanceHash = await client.hGetAll(balanceKeys.record(subredditId, userId));
        const balance = deserializeUserBalance(balanceHash);
        if (!balance) {
          throw new NotFoundError(`Balance for ${userId} not found for settlement.`);
        }
        balances.set(userId, balance);
      }),
    );

    return {
      market,
      bets,
      balances,
    } satisfies SettlementState;
  }

  private async applySettlement(
    tx: TxClientLike,
    subredditId: SubredditId,
    params: SettlementParams,
    state: SettlementState,
  ): Promise<MarketSettlementResult> {
    const timestamp = nowIso();
  let totalPayout = 0;
  let winners = 0;
  let refunded = 0;
  let processedBets = 0;

    const supportingPot =
      params.mode === 'resolve'
        ? params.resolution === 'yes'
          ? state.market.potYes
          : state.market.potNo
        : 0;
    const opposingPot =
      params.mode === 'resolve'
        ? params.resolution === 'yes'
          ? state.market.potNo
          : state.market.potYes
        : 0;

    for (const bet of state.bets) {
      if (bet.status !== 'active') {
        continue;
      }

      const balance = state.balances.get(bet.userId);
      if (!balance) {
        throw new NotFoundError(`Balance for ${bet.userId} not found for settlement.`);
      }

      processedBets += 1;

      if (params.mode === 'resolve') {
        if (bet.side === params.resolution) {
          const payout = this.calculateWinnerPayout(bet.wager, supportingPot, opposingPot);
          const snapshot = this.buildBalanceAfterPayout(balance, payout as Points, timestamp);
          await this.balances.applySnapshot(tx, snapshot);
          await this.ledger.record(tx, {
            subredditId,
            userId: bet.userId,
            marketId: bet.marketId,
            betId: bet.id,
            type: 'payout',
            delta: payout as Points,
            balanceAfter: snapshot.balance,
            metadata: {
              reason: 'market_resolved',
              resolution: params.resolution,
            },
          });
          state.balances.set(bet.userId, snapshot);
          totalPayout += payout;
          winners += 1;

          const updatedBet: Bet = {
            ...bet,
            status: 'won',
            payout: payout as Points,
            settledAt: timestamp,
          };
          await this.bets.update(tx, subredditId, bet, updatedBet);
        } else {
          const updatedBet: Bet = {
            ...bet,
            status: 'lost',
            payout: 0 as Points,
            settledAt: timestamp,
          };
          await this.bets.update(tx, subredditId, bet, updatedBet);
        }
      } else {
        const refund = bet.wager;
        const snapshot = this.buildBalanceAfterRefund(balance, refund as Points, timestamp);
        await this.balances.applySnapshot(tx, snapshot);
        await this.ledger.record(tx, {
          subredditId,
          userId: bet.userId,
          marketId: bet.marketId,
          betId: bet.id,
          type: 'refund',
          delta: refund as Points,
          balanceAfter: snapshot.balance,
          metadata: {
            reason: 'market_void',
            voidReason: params.reason,
          },
        });
        state.balances.set(bet.userId, snapshot);
        totalPayout += refund;
        refunded += 1;

        const updatedBet: Bet = {
          ...bet,
          status: 'refunded',
          payout: refund as Points,
          settledAt: timestamp,
        };
        await this.bets.update(tx, subredditId, bet, updatedBet);
      }

      await this.markets.clearUserBetPointer(tx, subredditId, bet.marketId, bet.userId);
    }

    const updatedMarket =
      params.mode === 'resolve'
        ? this.buildResolvedMarket(
            state.market,
            params.resolution,
            timestamp,
            params.moderatorId,
            params.moderatorUsername,
            params.notes,
          )
        : this.buildVoidMarket(
            state.market,
            timestamp,
            params.moderatorId,
            params.moderatorUsername,
            params.reason,
          );

    await this.markets.applyUpdate(tx, subredditId, state.market, updatedMarket);

    return {
      market: updatedMarket,
      totals: {
        settledBets: processedBets,
        winners,
        refunded,
        totalPayout: totalPayout as Points,
      },
    } satisfies MarketSettlementResult;
  }

  private calculateWinnerPayout(wager: Points, supportingPot: Points, opposingPot: Points): number {
    if (supportingPot <= 0) {
      return wager;
    }

    const totalPool = supportingPot + opposingPot;
    if (totalPool <= 0) {
      return wager;
    }

    const raw = (wager / supportingPot) * totalPool;
    const payout = Math.max(wager, Math.floor(raw));
    return payout;
  }

  private async closeMarketInternal(
    subredditId: SubredditId,
    market: Market,
    options: CloseMarketInternalOptions,
  ): Promise<Market> {
    await this.scheduler.cancelMarketClose(subredditId, market.id);

    const timestamp = nowIso();
    const metadataPatch: Record<string, unknown | undefined> = {
      lastClosedAt: timestamp,
    };

    if ('moderatorId' in options) {
      metadataPatch.closedBy = options.moderatorId ?? undefined;
      metadataPatch.closedByUsername = options.moderatorUsername ?? undefined;
    }

    if (options.auto) {
      metadataPatch.autoClosedByScheduler = true;
      metadataPatch.lastAutoClosedAt = timestamp;
    } else {
      metadataPatch.autoClosedByScheduler = undefined;
      metadataPatch.lastAutoClosedAt = undefined;
    }

    const updated = this.applyMarketPatch(
      market,
      {
        status: 'closed',
      },
      metadataPatch,
    );

    return this.markets.save(subredditId, updated);
  }

  private async archiveMarketData(
    subredditId: SubredditId,
    market: Market,
    bets: readonly Bet[],
    options: { moderatorId?: UserId | null },
  ): Promise<void> {
    const watchKeys = new Set<string>();
    const marketKey = marketKeys.record(subredditId, market.id);
    const betIndexKey = marketKeys.betsIndex(subredditId, market.id);
    watchKeys.add(marketKey);
    watchKeys.add(betIndexKey);

    bets.forEach((bet) => {
      watchKeys.add(betKeys.record(subredditId, bet.id));
      watchKeys.add(userKeys.betsAll(subredditId, bet.userId));
      watchKeys.add(userKeys.betsActive(subredditId, bet.userId));
      watchKeys.add(marketKeys.userPointer(subredditId, bet.marketId, bet.userId));
    });

    const timestamp = nowIso();
    const keys = Array.from(watchKeys);

    await runTransactionWithRetry<void, { market: Market }>(
      keys,
      async (tx, state) => {
        for (const bet of bets) {
          await this.bets.delete(tx, subredditId, bet);
          await this.markets.clearUserBetPointer(tx, subredditId, bet.marketId, bet.userId);
        }

        await tx.del(betIndexKey);

        const updated = this.applyMarketPatch(
          state.market,
          {} as Partial<Omit<Market, 'metadata'>>,
          {
            archivedAt: timestamp,
            archivedBy: options.moderatorId ?? null,
            archivedBetCount: bets.length,
          },
        );

        await this.markets.applyUpdate(tx, subredditId, state.market, updated);
      },
      {
        label: 'market:archive',
        loadState: async (client: RedisClient) => {
          const hash = await client.hGetAll(marketKey);
          const current = deserializeMarket(hash);
          if (!current) {
            throw new NotFoundError(`Market ${market.id} not found.`);
          }
          return { market: current };
        },
      },
    );
  }

  private normalizeArchivableStatuses(statuses?: ReadonlyArray<MarketStatus>): MarketStatus[] {
    const fallback: MarketStatus[] = ['resolved', 'void'];
    if (!statuses || statuses.length === 0) {
      return fallback;
    }

    const filtered = Array.from(new Set(statuses)).filter((status) => this.isArchivableStatus(status));
    return filtered.length > 0 ? filtered : fallback;
  }

  private isArchivableStatus(status: MarketStatus): boolean {
    return status === 'resolved' || status === 'void' || status === 'closed';
  }

  private getLifecycleTimestamp(market: Market): number | null {
    const candidates = [
      this.getMetadataTimestamp(market, 'lastSettledAt'),
      market.resolvedAt ? this.parseIsoTimestamp(market.resolvedAt) : null,
      this.getMetadataTimestamp(market, 'lastAutoClosedAt'),
      this.getMetadataTimestamp(market, 'lastClosedAt'),
      this.getMetadataTimestamp(market, 'lastPublishedAt'),
    ];

    for (const candidate of candidates) {
      if (candidate !== null) {
        return candidate;
      }
    }

    return null;
  }

  private getMetadataTimestamp(market: Market, key: string): number | null {
    const metadata = market.metadata as Record<string, unknown> | undefined;
    if (!metadata || !(key in metadata)) {
      return null;
    }

    return this.parseIsoTimestamp(metadata[key]);
  }

  private parseIsoTimestamp(value: unknown): number | null {
    if (typeof value !== 'string') {
      return null;
    }

    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }

  private isAlreadyArchived(market: Market): boolean {
    const metadata = market.metadata as Record<string, unknown> | undefined;
    if (!metadata) {
      return false;
    }

    return this.parseIsoTimestamp(metadata.archivedAt) !== null;
  }

  private buildBalanceAfterPayout(
    balance: UserBalance,
    amount: Points,
    timestamp: string,
  ): UserBalance {
    return {
      ...balance,
      balance: balance.balance + amount,
      lifetimeEarned: balance.lifetimeEarned + amount,
      weeklyEarned: balance.weeklyEarned + amount,
      monthlyEarned: balance.monthlyEarned + amount,
      updatedAt: timestamp,
    } satisfies UserBalance;
  }

  private buildBalanceAfterRefund(
    balance: UserBalance,
    amount: Points,
    timestamp: string,
  ): UserBalance {
    const lifetimeLost = Math.max(0, balance.lifetimeLost - amount);
    return {
      ...balance,
      balance: balance.balance + amount,
      lifetimeLost,
      updatedAt: timestamp,
    } satisfies UserBalance;
  }

  private buildResolvedMarket(
    market: Market,
    resolution: BetSide,
    settledAt: string,
    moderatorId?: UserId | null,
    moderatorUsername?: string | null,
    notes?: string,
  ): Market {
    const metadataPatch: Record<string, unknown | undefined> = {
      resolvedBy: moderatorId ?? undefined,
      resolvedByUsername: moderatorUsername ?? undefined,
      resolutionNotes: notes,
      lastSettledAt: settledAt,
    };

    return this.applyMarketPatch(
      market,
      {
        status: 'resolved',
        resolution,
        resolvedAt: settledAt,
      },
      metadataPatch,
    );
  }

  private buildVoidMarket(
    market: Market,
    settledAt: string,
    moderatorId?: UserId | null,
    moderatorUsername?: string | null,
    reason?: string,
  ): Market {
    const metadataPatch: Record<string, unknown | undefined> = {
      voidedBy: moderatorId ?? undefined,
      voidedByUsername: moderatorUsername ?? undefined,
      voidReason: reason,
      lastSettledAt: settledAt,
    };

    return this.applyMarketPatch(
      market,
      {
        status: 'void',
        resolution: 'void',
        resolvedAt: settledAt,
      },
      metadataPatch,
    );
  }

  private applyMarketPatch(
    market: Market,
    overrides: Partial<Omit<Market, 'metadata'>>,
    metadataPatch?: Record<string, unknown | undefined>,
  ): Market {
    const metadata = { ...(market.metadata ?? {}) } as Record<string, unknown>;

    if (metadataPatch) {
      for (const [key, value] of Object.entries(metadataPatch)) {
        if (value === undefined) {
          delete metadata[key];
        } else {
          metadata[key] = value;
        }
      }
    }

    const candidate: Omit<Market, 'metadata'> & { metadata?: Record<string, unknown> } = {
      ...market,
      ...overrides,
    };

    const metadataKeys = Object.keys(metadata);
    if (metadataKeys.length > 0) {
      candidate.metadata = metadata;
    } else {
      delete (candidate as { metadata?: Record<string, unknown> }).metadata;
    }

    return candidate as Market;
  }

  private normalizeAutoCloseOverride(value?: number | null): number | null | undefined {
    if (value === undefined) {
      return undefined;
    }

    if (value === null) {
      return null;
    }

    return value;
  }

  private calculateAutoCloseTime(closesAt: string, minutes: number | null): Date | null {
    const closeTime = Date.parse(closesAt);
    if (Number.isNaN(closeTime)) {
      return null;
    }

    if (minutes === null) {
      return null;
    }

    const grace = minutes ?? 0;
    const runAtMillis = closeTime + Math.max(0, grace) * 60_000;
    if (runAtMillis <= Date.now()) {
      return null;
    }

    return new Date(runAtMillis);
  }
}
