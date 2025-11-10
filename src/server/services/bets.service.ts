import type { TxClientLike, RedisClient } from '@devvit/redis';
import type {
  Bet,
  BetStatus,
  Market,
  Points,
  SubredditId,
  UserBalance,
  UserId,
} from '../../shared/types/entities.js';
import type {
  BetSummary,
  PaginatedResponse,
  PlaceBetRequest,
  PlaceBetResponse,
  WalletSnapshot,
} from '../../shared/types/dto.js';
import type { AppConfig } from '../../shared/types/config.js';
import { MarketRepository } from '../repositories/market.repository.js';
import { BetRepository } from '../repositories/bet.repository.js';
import { BalanceRepository } from '../repositories/balance.repository.js';
import { LedgerService } from './ledger.service.js';
import { ConfigService } from './config.service.js';
import { createBetId } from '../utils/id.js';
import { nowIso } from '../utils/time.js';
import { runTransactionWithRetry } from '../utils/transactions.js';
import { balanceKeys, marketKeys } from '../utils/redis-keys.js';
import { deserializeMarket, deserializeUserBalance } from '../utils/serializers.js';
import { NotFoundError, ValidationError } from '../errors.js';

interface BetPlacementState {
  readonly market: Market;
  readonly balance: UserBalance;
  readonly pointer: Bet['id'] | null;
}

interface BetPlacementResult {
  readonly bet: Bet;
  readonly market: Market;
  readonly balance: UserBalance;
}

export class BetsService {
  private readonly markets: MarketRepository;
  private readonly bets: BetRepository;
  private readonly balances: BalanceRepository;
  private readonly ledger: LedgerService;
  private readonly config: ConfigService;

  constructor(
    markets = new MarketRepository(),
    bets = new BetRepository(),
    balances = new BalanceRepository(),
    ledger = new LedgerService(),
    config = new ConfigService(),
  ) {
    this.markets = markets;
    this.bets = bets;
    this.balances = balances;
    this.ledger = ledger;
    this.config = config;
  }

  async placeBet(
    subredditId: SubredditId,
    userId: UserId,
    request: PlaceBetRequest,
  ): Promise<PlaceBetResponse> {
    const config = await this.config.getConfig(subredditId);
    this.validateWager(request.wager, config.minBet, config.maxBet);

    const marketExists = await this.markets.getById(subredditId, request.marketId);
    if (!marketExists) {
      throw new NotFoundError(`Market ${request.marketId} not found.`);
    }

    await this.ensureBalanceRecord(subredditId, userId, config);

    const balanceKey = balanceKeys.record(subredditId, userId);
    const marketKey = marketKeys.record(subredditId, request.marketId);
    const pointerKey = marketKeys.userPointer(subredditId, request.marketId, userId);

    const result = await runTransactionWithRetry<BetPlacementResult, BetPlacementState>(
      [marketKey, balanceKey, pointerKey],
      async (tx, state) => this.executeBetPlacement(tx, subredditId, userId, request, state),
      {
        label: 'bet:place',
        loadState: async (client) =>
          this.loadBetPlacementState(client, subredditId, userId, request.marketId),
      },
    );

    const activeBets = await this.bets.countActiveByUser(subredditId, userId);
    const walletSnapshot = this.toWalletSnapshot(result.balance, activeBets);
    const marketDetail = { ...result.market, userBet: result.bet };

    return {
      bet: result.bet,
      balance: walletSnapshot,
      market: marketDetail,
    } satisfies PlaceBetResponse;
  }

  async getWallet(subredditId: SubredditId, userId: UserId): Promise<WalletSnapshot> {
    const balance = await this.ensureBalanceRecord(subredditId, userId);
    const activeBets = await this.bets.countActiveByUser(subredditId, userId);
    return this.toWalletSnapshot(balance, activeBets);
  }

  async listUserBets(
    subredditId: SubredditId,
    userId: UserId,
    options?: {
      status?: BetStatus;
      page?: number;
      pageSize?: number;
    },
  ): Promise<PaginatedResponse<BetSummary>> {
    const page = Math.max(1, options?.page ?? 1);
    const pageSize = Math.min(Math.max(1, options?.pageSize ?? 25), 100);
    const totalBets = await this.bets.countAllByUser(subredditId, userId);

    if (totalBets === 0) {
      return {
        data: [],
        pagination: { page, pageSize, total: 0 },
      } satisfies PaginatedResponse<BetSummary>;
    }

    const allBets = await this.bets.listByUser(subredditId, userId, {
      offset: 0,
      limit: totalBets,
    });

    const sorted = [...allBets].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    const statusFilter = options?.status;
    const filtered = statusFilter ? sorted.filter((bet) => bet.status === statusFilter) : sorted;
    const total = filtered.length;

    if (total === 0) {
      return {
        data: [],
        pagination: { page, pageSize, total: 0 },
      } satisfies PaginatedResponse<BetSummary>;
    }

    const offset = (page - 1) * pageSize;
    const paged = filtered.slice(offset, offset + pageSize);
    const summaries = await Promise.all(paged.map((bet) => this.buildBetSummary(subredditId, bet)));

    return {
      data: summaries,
      pagination: { page, pageSize, total },
    } satisfies PaginatedResponse<BetSummary>;
  }

  private async executeBetPlacement(
    tx: TxClientLike,
    subredditId: SubredditId,
    userId: UserId,
    request: PlaceBetRequest,
    state: BetPlacementState,
  ): Promise<BetPlacementResult> {
    if (state.market.status !== 'open') {
      throw new ValidationError('Market is not accepting new bets.');
    }

    if (Date.parse(state.market.closesAt) <= Date.now()) {
      throw new ValidationError('Market is closed for betting.');
    }

    if (state.pointer) {
      throw new ValidationError('User already has an active bet on this market.');
    }

    if (state.balance.balance < request.wager) {
      throw new ValidationError('Insufficient balance to place bet.');
    }

    const bet: Bet = {
      schemaVersion: 1,
      id: createBetId(),
      marketId: request.marketId,
      userId,
      side: request.side,
      wager: request.wager,
      createdAt: nowIso(),
      status: 'active',
      payout: null,
      settledAt: null,
    };

    const updatedMarket = this.applyMarketChanges(state.market, request.side, request.wager);
    const updatedBalance = this.applyBalanceChanges(state.balance, request.wager);

    await this.bets.create(tx, subredditId, request.marketId, bet);
    await this.markets.setUserBetPointer(tx, subredditId, request.marketId, userId, bet.id);
    await this.markets.applyUpdate(tx, subredditId, state.market, updatedMarket);
    await this.balances.applySnapshot(tx, updatedBalance);
    await this.ledger.record(tx, {
      subredditId,
      userId,
      marketId: request.marketId,
      betId: bet.id,
      type: 'debit',
      delta: request.wager as Points,
      balanceAfter: updatedBalance.balance,
      metadata: { reason: 'bet_placed' },
    });

    return { bet, market: updatedMarket, balance: updatedBalance } satisfies BetPlacementResult;
  }

  private async loadBetPlacementState(
    client: RedisClient,
    subredditId: SubredditId,
    userId: UserId,
    marketId: Market['id'],
  ): Promise<BetPlacementState> {
    const marketKey = marketKeys.record(subredditId, marketId);
    const balanceKey = balanceKeys.record(subredditId, userId);
    const pointerKey = marketKeys.userPointer(subredditId, marketId, userId);

    const [marketHash, balanceHash, pointerRaw] = await Promise.all([
      client.hGetAll(marketKey),
      client.hGetAll(balanceKey),
      client.get(pointerKey),
    ]);

    const market = deserializeMarket(marketHash);
    if (!market) {
      throw new NotFoundError(`Market ${marketId} not found.`);
    }

    const balance = deserializeUserBalance(balanceHash);
    if (!balance) {
      throw new NotFoundError('User balance not initialized.');
    }

    return {
      market,
      balance,
      pointer: pointerRaw ? (pointerRaw as Bet['id']) : null,
    } satisfies BetPlacementState;
  }

  private applyMarketChanges(market: Market, side: Bet['side'], wager: Points): Market {
    const base: Omit<Market, 'metadata'> & { metadata?: Record<string, unknown> } = {
      ...market,
      potYes: market.potYes + (side === 'yes' ? wager : 0),
      potNo: market.potNo + (side === 'no' ? wager : 0),
      totalBets: market.totalBets + 1,
    };

    return base as Market;
  }

  private applyBalanceChanges(balance: UserBalance, wager: Points): UserBalance {
    return {
      ...balance,
      balance: balance.balance - wager,
      lifetimeLost: balance.lifetimeLost + wager,
      updatedAt: nowIso(),
    } satisfies UserBalance;
  }

  private toWalletSnapshot(balance: UserBalance, activeBets: number): WalletSnapshot {
    return {
      userId: balance.userId,
      subredditId: balance.subredditId,
      balance: balance.balance,
      lifetimeEarned: balance.lifetimeEarned,
      lifetimeLost: balance.lifetimeLost,
      weeklyEarned: balance.weeklyEarned,
      monthlyEarned: balance.monthlyEarned,
      updatedAt: balance.updatedAt,
      activeBets,
    } satisfies WalletSnapshot;
  }

  private validateWager(wager: Points, minBet: number, maxBet: number | null) {
    if (wager < minBet) {
      throw new ValidationError(`Minimum bet is ${minBet}.`);
    }

    if (maxBet !== null && wager > maxBet) {
      throw new ValidationError(`Maximum bet is ${maxBet}.`);
    }
  }

  private async ensureBalanceRecord(
    subredditId: SubredditId,
    userId: UserId,
    config?: AppConfig,
  ): Promise<UserBalance> {
    const existing = await this.balances.get(subredditId, userId);
    if (existing) {
      return existing;
    }

    const resolvedConfig = config ?? (await this.config.getConfig(subredditId));
    const snapshot: UserBalance = {
      schemaVersion: 1,
      userId,
      subredditId,
      balance: resolvedConfig.startingBalance,
      lifetimeEarned: 0,
      lifetimeLost: 0,
      weeklyEarned: 0,
      monthlyEarned: 0,
      updatedAt: nowIso(),
    } satisfies UserBalance;

    return this.balances.create(snapshot);
  }

  private async buildBetSummary(subredditId: SubredditId, bet: Bet): Promise<BetSummary> {
    const market = await this.markets.getById(subredditId, bet.marketId);

    return {
      id: bet.id,
      marketId: bet.marketId,
      side: bet.side,
      wager: bet.wager,
      status: bet.status,
      createdAt: bet.createdAt,
      payout: bet.payout,
      settledAt: bet.settledAt,
      marketTitle: market?.title ?? 'Unknown Market',
      marketStatus: market?.status ?? 'void',
    } satisfies BetSummary;
  }
}
