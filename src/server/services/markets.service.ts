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
import { MarketRepository } from '../repositories/market.repository.js';
import { BetRepository } from '../repositories/bet.repository.js';
import { ConfigService } from './config.service.js';
import { BalanceRepository } from '../repositories/balance.repository.js';
import { LedgerService } from './ledger.service.js';
import { SchedulerService } from './scheduler.service.js';
import { createMarketId } from '../utils/id.js';
import { nowIso } from '../utils/time.js';
import type { CreateMarketRequest } from '../../shared/types/dto.js';
import { NotFoundError, ValidationError } from '../errors.js';
import type { TxClientLike, RedisClient } from '@devvit/redis';
import { balanceKeys, betKeys, marketKeys } from '../utils/redis-keys.js';
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
  readonly notes?: string;
};

type VoidSettlementParams = {
  readonly mode: 'void';
  readonly moderatorId?: UserId | null;
  readonly reason: string;
};

type SettlementParams = ResolveSettlementParams | VoidSettlementParams;

type PublishMarketOptions = {
  readonly moderatorId?: UserId | null;
  readonly autoCloseOverrideMinutes?: number | null;
};

type CloseMarketOptions = {
  readonly moderatorId?: UserId | null;
};

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

  constructor(
    markets = new MarketRepository(),
    bets = new BetRepository(),
    balances = new BalanceRepository(),
    ledger = new LedgerService(),
    scheduler = new SchedulerService(),
    config = new ConfigService(),
  ) {
    this.markets = markets;
    this.bets = bets;
    this.balances = balances;
    this.ledger = ledger;
    this.scheduler = scheduler;
    this.config = config;
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
    return market;
  }

  async resolveMarket(
    subredditId: SubredditId,
    marketId: MarketId,
    resolution: BetSide,
    options?: { moderatorId?: UserId | null; notes?: string },
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
      ...(options?.notes !== undefined ? { notes: options.notes } : {}),
    };

    return this.settleMarket(subredditId, market, bets, settlementParams);
  }

  async voidMarket(
    subredditId: SubredditId,
    marketId: MarketId,
    reason: string,
    options?: { moderatorId?: UserId | null },
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
    };

    return this.settleMarket(subredditId, market, bets, settlementParams);
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

    await this.scheduler.cancelMarketClose(subredditId, marketId);

    const timestamp = nowIso();
    const metadataPatch: Record<string, unknown> = {
      closedBy: options?.moderatorId ?? undefined,
      lastClosedAt: timestamp,
    };

    const updated = this.applyMarketPatch(
      market,
      {
        status: 'closed',
      },
      metadataPatch,
    );

    return this.markets.save(subredditId, updated);
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
            params.notes,
          )
        : this.buildVoidMarket(state.market, timestamp, params.moderatorId, params.reason);

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
    notes?: string,
  ): Market {
    const metadataPatch: Record<string, unknown | undefined> = {
      resolvedBy: moderatorId ?? undefined,
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
    reason?: string,
  ): Market {
    const metadataPatch: Record<string, unknown | undefined> = {
      voidedBy: moderatorId ?? undefined,
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
