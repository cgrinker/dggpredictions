import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  Bet,
  Market,
  MarketId,
  Points,
  SubredditId,
  UserBalance,
  UserId,
} from '../../../shared/types/entities.js';
import type { AppConfig } from '../../../shared/types/config.js';
import type { MarketRepository } from '../../repositories/market.repository.js';
import type { BetRepository } from '../../repositories/bet.repository.js';
import type { BalanceRepository } from '../../repositories/balance.repository.js';
import type { LedgerService } from '../ledger.service.js';
import type { ConfigService } from '../config.service.js';
import type { SchedulerService } from '../scheduler.service.js';

const runTransactionMock = vi.fn();

type VitestMock = ReturnType<typeof vi.fn>;

vi.mock('../../utils/transactions.js', () => ({
  runTransactionWithRetry: (...args: unknown[]) => runTransactionMock(...args),
}));

let MarketsServiceClass: typeof import('../markets.service.js').MarketsService;
let settlementState: {
  market: Market;
  bets: Bet[];
  balances: Map<UserId, UserBalance>;
};

const createMarket = (overrides: Partial<Market> = {}): Market => ({
  schemaVersion: 1,
  id: 'market-1' as MarketId,
  subredditId: 'sub-1' as SubredditId,
  title: 'Example Market',
  description: 'Example description',
  createdBy: 'mod-1' as UserId,
  createdAt: new Date().toISOString(),
  closesAt: new Date(Date.now() + 60_000).toISOString(),
  resolvedAt: null,
  status: 'closed',
  resolution: null,
  potYes: 1_000 as Points,
  potNo: 1_000 as Points,
  totalBets: 2,
  metadata: {},
  ...overrides,
});

const createBet = (overrides: Partial<Bet>): Bet => ({
  schemaVersion: 1,
  id: `${overrides.side ?? 'bet'}-${Math.random()}` as Bet['id'],
  marketId: 'market-1' as MarketId,
  userId: `${overrides.side ?? 'user'}-id` as UserId,
  side: 'yes',
  wager: 100 as Points,
  createdAt: new Date().toISOString(),
  status: 'active',
  payout: null,
  settledAt: null,
  ...overrides,
});

const createBalance = (userId: UserId, overrides: Partial<UserBalance> = {}): UserBalance => ({
  schemaVersion: 1,
  userId,
  subredditId: 'sub-1' as SubredditId,
  balance: 0 as Points,
  lifetimeEarned: 0 as Points,
  lifetimeLost: 0 as Points,
  weeklyEarned: 0 as Points,
  monthlyEarned: 0 as Points,
  updatedAt: new Date().toISOString(),
  ...overrides,
});

beforeAll(async () => {
  ({ MarketsService: MarketsServiceClass } = await import('../markets.service.js'));
});

beforeEach(() => {
  runTransactionMock.mockImplementation(async (_keys: unknown, handler: unknown) => {
    const handlerFn = handler as (tx: unknown, state: typeof settlementState) => Promise<unknown>;
    return handlerFn({} as Record<string, never>, settlementState);
  });
  runTransactionMock.mockClear();
});

const setupService = (options?: {
  marketOverrides?: Partial<Market>;
  configOverrides?: Partial<AppConfig>;
  schedulerOverrides?: Partial<SchedulerService>;
}) => {
  const market = createMarket(options?.marketOverrides ?? {});
  const yesBet = createBet({ side: 'yes' });
  const noBet = createBet({ side: 'no' });

  const marketRepo: Partial<MarketRepository> = {
    getById: vi.fn().mockResolvedValue(market),
    applyUpdate: vi.fn().mockResolvedValue(undefined),
    clearUserBetPointer: vi.fn().mockResolvedValue(undefined),
    save: vi.fn().mockImplementation(async (_subredditId: SubredditId, candidate: Market) => candidate),
  };

  const betRepo: Partial<BetRepository> = {
    listByMarket: vi.fn().mockResolvedValue([yesBet, noBet]),
    update: vi.fn().mockResolvedValue(undefined),
  };

  const balanceRepo: Partial<BalanceRepository> = {
    applySnapshot: vi.fn().mockResolvedValue(undefined),
  };

  const ledgerService: Partial<LedgerService> = {
    record: vi.fn().mockResolvedValue(undefined),
  };

  const baseConfig: AppConfig = {
    startingBalance: 1_000,
    minBet: 1,
    maxBet: null,
    maxOpenMarkets: null,
    leaderboardWindow: 'weekly',
    autoCloseGraceMinutes: 5,
    featureFlags: {
      maintenanceMode: false,
      enableRealtimeUpdates: true,
      enableLeaderboard: true,
    },
  };

  const configService: Partial<ConfigService> = {
    getConfig: vi.fn().mockResolvedValue({ ...baseConfig, ...(options?.configOverrides ?? {}) }),
  };

  const schedulerService: Partial<SchedulerService> = {
    cancelMarketClose: vi.fn().mockResolvedValue(undefined),
    scheduleMarketClose: vi.fn().mockResolvedValue('job-123'),
    getMarketCloseJob: vi.fn().mockResolvedValue(null),
  };

  Object.assign(schedulerService, options?.schedulerOverrides);

  const service = new MarketsServiceClass(
    marketRepo as MarketRepository,
    betRepo as BetRepository,
    balanceRepo as BalanceRepository,
    ledgerService as LedgerService,
    schedulerService as SchedulerService,
    configService as ConfigService,
  );

  settlementState = {
    market,
    bets: [yesBet, noBet],
    balances: new Map<UserId, UserBalance>([
      [yesBet.userId, createBalance(yesBet.userId)],
      [noBet.userId, createBalance(noBet.userId)],
    ]),
  };

  return {
    service,
    marketRepo,
    betRepo,
    balanceRepo,
    ledgerService,
    schedulerService,
    configService,
    market,
    yesBet,
    noBet,
  };
};

describe('MarketsService settlement', () => {
  it('resolves market and pays winners', async () => {
    const { service, marketRepo, betRepo, balanceRepo, ledgerService, yesBet, noBet } =
      setupService();

    const response = await service.resolveMarket(
      'sub-1' as SubredditId,
      'market-1' as MarketId,
      'yes',
      { moderatorId: 'mod-7' as UserId, notes: 'Resolved automatically' },
    );

    expect(response.market.status).toBe('resolved');
    expect(response.market.resolution).toBe('yes');
    expect(response.totals.winners).toBe(1);
    expect(response.totals.refunded).toBe(0);
    expect(response.totals.settledBets).toBe(2);
    expect(response.totals.totalPayout).toBeGreaterThan(0);

    expect(balanceRepo.applySnapshot).toHaveBeenCalledTimes(1);
    const snapshot = (balanceRepo.applySnapshot as VitestMock).mock.calls[0][1] as UserBalance;
    expect(snapshot.balance).toBeGreaterThan(0);

    expect(ledgerService.record).toHaveBeenCalledTimes(1);
    expect(ledgerService.record).toHaveBeenCalledWith(expect.anything(), {
      subredditId: 'sub-1',
      userId: yesBet.userId,
      marketId: yesBet.marketId,
      betId: yesBet.id,
      type: 'payout',
      delta: expect.any(Number),
      balanceAfter: expect.any(Number),
      metadata: expect.objectContaining({ resolution: 'yes' }),
    });

    expect(betRepo.update).toHaveBeenCalledTimes(2);
    expect(marketRepo.clearUserBetPointer).toHaveBeenCalledWith(
      expect.anything(),
      'sub-1',
      yesBet.marketId,
      yesBet.userId,
    );
    expect(marketRepo.clearUserBetPointer).toHaveBeenCalledWith(
      expect.anything(),
      'sub-1',
      noBet.marketId,
      noBet.userId,
    );
    expect(marketRepo.applyUpdate).toHaveBeenCalledWith(
      expect.anything(),
      'sub-1',
      expect.anything(),
      expect.objectContaining({ status: 'resolved' }),
    );
  });

  it('voids market and refunds bets', async () => {
    const { service, marketRepo, betRepo, balanceRepo, ledgerService } = setupService({
      marketOverrides: { status: 'open' },
    });

    const response = await service.voidMarket(
      'sub-1' as SubredditId,
      'market-1' as MarketId,
      'Cancelled due to issue',
      { moderatorId: 'mod-99' as UserId },
    );

    expect(response.market.status).toBe('void');
    expect(response.totals.winners).toBe(0);
    expect(response.totals.refunded).toBe(2);
    expect(response.totals.totalPayout).toBe(200);

    expect(balanceRepo.applySnapshot).toHaveBeenCalledTimes(2);
    expect(ledgerService.record).toHaveBeenCalledTimes(2);
    (ledgerService.record as VitestMock).mock.calls.forEach((call) => {
      const [, entry] = call as [unknown, { type: string }];
      expect(entry.type).toBe('refund');
    });

    expect(betRepo.update).toHaveBeenCalledTimes(2);
    expect(marketRepo.applyUpdate).toHaveBeenCalledWith(
      expect.anything(),
      'sub-1',
      expect.anything(),
      expect.objectContaining({ status: 'void' }),
    );
  });
});

describe('MarketsService lifecycle', () => {
  const subredditId = 'sub-1' as SubredditId;
  const marketId = 'market-1' as MarketId;

  it('publishes a draft market and schedules auto-close job', async () => {
    const closesAtDate = new Date(Date.now() + 60 * 60 * 1_000);
    const closesAt = closesAtDate.toISOString();
    const moderatorId = 'mod-22' as UserId;

    const { service, schedulerService, marketRepo } = setupService({
      marketOverrides: { status: 'draft', closesAt },
    });

    const result = await service.publishMarket(subredditId, marketId, { moderatorId });

    expect(result.status).toBe('open');
    expect(result.metadata?.publishedBy).toBe(moderatorId);
    expect(result.metadata?.lastPublishedAt).toBeDefined();
    expect(result.metadata?.autoCloseOverrideMinutes).toBeUndefined();

    expect(schedulerService.cancelMarketClose).toHaveBeenCalledWith(subredditId, marketId);

    const scheduleCalls = (schedulerService.scheduleMarketClose as VitestMock).mock.calls;
    expect(scheduleCalls).toHaveLength(1);
    expect(scheduleCalls[0][0]).toBe(subredditId);
    expect(scheduleCalls[0][1]).toBe(marketId);
    const scheduledRunAt = scheduleCalls[0][2].runAt as Date;
  const expectedRunAt = new Date(closesAtDate.getTime() + 5 * 60_000);
    expect(scheduledRunAt.toISOString()).toBe(expectedRunAt.toISOString());

    const savedMarket = (marketRepo.save as VitestMock).mock.calls[0][1] as Market;
    expect(savedMarket.status).toBe('open');
  });

  it('does not schedule auto-close when override disables it', async () => {
    const closesAt = new Date(Date.now() + 90 * 60 * 1_000).toISOString();

    const { service, schedulerService } = setupService({
      marketOverrides: { status: 'draft', closesAt },
    });

    const result = await service.publishMarket(subredditId, marketId, {
      autoCloseOverrideMinutes: null,
    });

    expect(result.status).toBe('open');
    expect(result.metadata?.autoCloseOverrideMinutes).toBeNull();
    expect(schedulerService.cancelMarketClose).toHaveBeenCalledWith(subredditId, marketId);
    expect(schedulerService.scheduleMarketClose).not.toHaveBeenCalled();
  });

  it('closes an open market and cancels outstanding job', async () => {
    const moderatorId = 'mod-33' as UserId;

    const { service, schedulerService, marketRepo } = setupService({
      marketOverrides: { status: 'open' },
    });

    const result = await service.closeMarket(subredditId, marketId, { moderatorId });

    expect(result.status).toBe('closed');
    expect(result.metadata?.closedBy).toBe(moderatorId);
    expect(result.metadata?.lastClosedAt).toBeDefined();
    expect(schedulerService.cancelMarketClose).toHaveBeenCalledWith(subredditId, marketId);
    expect(schedulerService.scheduleMarketClose).not.toHaveBeenCalled();

    const savedMarket = (marketRepo.save as VitestMock).mock.calls[0][1] as Market;
    expect(savedMarket.status).toBe('closed');
  });
});
