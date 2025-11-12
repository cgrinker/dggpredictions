import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  Bet,
  Market,
  MarketId,
  MarketStatus,
  ModeratorActionId,
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
import type { AuditLogService } from '../audit-log.service.js';

const runTransactionMock = vi.fn();

type VitestMock = ReturnType<typeof vi.fn>;

vi.mock('../../utils/transactions.js', () => ({
  runTransactionWithRetry: (...args: unknown[]) => runTransactionMock(...args),
}));

let MarketsServiceClass: typeof import('../markets.service.js').MarketsService;
type SettlementState = {
  market: Market;
  bets: Bet[];
  balances: Map<UserId, UserBalance>;
};

let settlementState: SettlementState;

const updateSettlementState = (next: Partial<SettlementState>) => {
  settlementState = {
    market: next.market ?? settlementState!.market,
    bets: next.bets ?? settlementState!.bets,
    balances: next.balances ?? settlementState!.balances,
  } satisfies SettlementState;
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

  runTransactionMock.mockImplementation(async (_keys: unknown, handler: unknown) => {
    const txStub = {
      hSet: vi.fn().mockResolvedValue(undefined),
      zAdd: vi.fn().mockResolvedValue(undefined),
      zRem: vi.fn().mockResolvedValue(undefined),
      set: vi.fn().mockResolvedValue(undefined),
      del: vi.fn().mockResolvedValue(undefined),
    };

    const handlerFn = handler as (
      tx: typeof txStub,
      state: typeof settlementState,
    ) => Promise<unknown>;

    return handlerFn(txStub, settlementState);
  });
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('MarketsService createDraft', () => {
  it('creates draft market and records audit entry', async () => {
    const marketsRepo: Partial<MarketRepository> = {
      list: vi.fn().mockResolvedValue({ markets: [], total: 0 }),
      create: vi.fn().mockResolvedValue(undefined),
    };

    const auditService: Partial<AuditLogService> = {
      recordAction: vi.fn().mockResolvedValue({
        schemaVersion: 1,
        id: 'audit-123' as ModeratorActionId,
        subredditId: 'sub-1' as SubredditId,
        performedBy: 'mod-1' as UserId,
        performedByUsername: 'mod-user',
        action: 'CREATE_MARKET',
        marketId: 'market-1' as MarketId,
        targetUserId: null,
        payload: {},
        createdAt: new Date().toISOString(),
      }),
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
      getConfig: vi.fn().mockResolvedValue(baseConfig),
    };

    const service = new MarketsServiceClass(
      marketsRepo as MarketRepository,
      {} as BetRepository,
      {} as BalanceRepository,
      {} as LedgerService,
      {} as SchedulerService,
      configService as ConfigService,
      auditService as AuditLogService,
    );

    const closesAt = new Date(Date.now() + 60_000).toISOString();
    const result = await service.createDraft(
      'sub-1' as SubredditId,
      'mod-1' as UserId,
      {
        title: 'Example Market',
        description: 'Sample description',
        closesAt,
        tags: ['tag1', 'tag2'],
      },
      { creatorUsername: 'mod-user' },
    );

    expect(result.status).toBe('draft');
    expect(result.title).toBe('Example Market');
    expect(marketsRepo.create).toHaveBeenCalledTimes(1);
    expect(marketsRepo.create).toHaveBeenCalledWith(
      'sub-1',
      expect.objectContaining({ title: 'Example Market', status: 'draft' }),
    );

    expect(auditService.recordAction).toHaveBeenCalledWith('sub-1', {
      performedBy: 'mod-1',
      performedByUsername: 'mod-user',
      action: 'CREATE_MARKET',
      marketId: result.id,
      payload: {
        title: 'Example Market',
        closesAt,
        tags: ['tag1', 'tag2'],
      },
    });
  });
});

const setupService = (options?: {
  marketOverrides?: Partial<Market>;
  configOverrides?: Partial<AppConfig>;
  schedulerOverrides?: Partial<SchedulerService>;
  marketRepoOverrides?: Partial<MarketRepository>;
  betRepoOverrides?: Partial<BetRepository>;
  balanceRepoOverrides?: Partial<BalanceRepository>;
  ledgerOverrides?: Partial<LedgerService>;
  auditOverrides?: Partial<AuditLogService>;
}) => {
  const market = createMarket(options?.marketOverrides ?? {});
  const yesBet = createBet({ side: 'yes' });
  const noBet = createBet({ side: 'no' });

  const marketRepo: Partial<MarketRepository> = {
    getById: vi.fn().mockResolvedValue(market),
    list: vi.fn().mockResolvedValue({ markets: [], total: 0 }),
    save: vi.fn().mockImplementation(async (_subredditId: SubredditId, candidate: Market) => candidate),
    applyUpdate: vi.fn().mockResolvedValue(undefined),
    clearUserBetPointer: vi.fn().mockResolvedValue(undefined),
  };

  const betRepo: Partial<BetRepository> = {
    listByMarket: vi.fn().mockResolvedValue([yesBet, noBet]),
    update: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
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

  const auditAction = {
    schemaVersion: 1,
    id: 'audit-1' as ModeratorActionId,
    subredditId: market.subredditId,
    performedBy: 'mod-1' as UserId,
    performedByUsername: 'mod-user',
    action: 'PUBLISH_MARKET' as const,
    marketId: market.id,
    targetUserId: null,
    payload: {},
    createdAt: new Date().toISOString(),
  };

  const auditService: Partial<AuditLogService> = {
    recordAction: vi.fn().mockResolvedValue(auditAction),
    listRecent: vi.fn().mockResolvedValue([]),
  };

  Object.assign(schedulerService, options?.schedulerOverrides);
  Object.assign(marketRepo, options?.marketRepoOverrides);
  Object.assign(betRepo, options?.betRepoOverrides);
  Object.assign(balanceRepo, options?.balanceRepoOverrides);
  Object.assign(ledgerService, options?.ledgerOverrides);
  Object.assign(auditService, options?.auditOverrides);

  const service = new MarketsServiceClass(
    marketRepo as MarketRepository,
    betRepo as BetRepository,
    balanceRepo as BalanceRepository,
    ledgerService as LedgerService,
    schedulerService as SchedulerService,
    configService as ConfigService,
    auditService as AuditLogService,
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
    auditService: auditService as AuditLogService,
  };
};

describe('MarketsService settlement', () => {
  it('resolves market and pays winners', async () => {
    const {
      service,
      marketRepo,
      betRepo,
      balanceRepo,
      ledgerService,
      yesBet,
      noBet,
      auditService,
    } = setupService();

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

    expect(auditService.recordAction).toHaveBeenCalledWith('sub-1', {
      performedBy: 'mod-7',
      performedByUsername: 'unknown',
      action: 'RESOLVE_MARKET',
      marketId: 'market-1',
      payload: expect.objectContaining({
        resolution: 'yes',
        totals: expect.objectContaining({ settledBets: 2 }),
      }),
    });
  });

  it('voids market and refunds bets', async () => {
    const { service, marketRepo, betRepo, balanceRepo, ledgerService, auditService } = setupService({
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

    expect(auditService.recordAction).toHaveBeenCalledWith('sub-1', {
      performedBy: 'mod-99',
      performedByUsername: 'unknown',
      action: 'VOID_MARKET',
      marketId: 'market-1',
      payload: { reason: 'Cancelled due to issue' },
    });
  });
});

describe('MarketsService lifecycle', () => {
  const subredditId = 'sub-1' as SubredditId;
  const marketId = 'market-1' as MarketId;

  it('publishes a draft market and schedules auto-close job', async () => {
    const closesAtDate = new Date(Date.now() + 60 * 60 * 1_000);
    const closesAt = closesAtDate.toISOString();
    const moderatorId = 'mod-22' as UserId;

    const { service, schedulerService, marketRepo, auditService } = setupService({
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

    expect(auditService.recordAction).toHaveBeenCalledWith(subredditId, {
      performedBy: moderatorId,
      performedByUsername: 'unknown',
      action: 'PUBLISH_MARKET',
      marketId,
      payload: expect.objectContaining({ autoCloseOverrideMinutes: 5 }),
    });
  });

  it('does not schedule auto-close when override disables it', async () => {
    const closesAt = new Date(Date.now() + 90 * 60 * 1_000).toISOString();

    const { service, schedulerService, auditService } = setupService({
      marketOverrides: { status: 'draft', closesAt },
    });

    const result = await service.publishMarket(subredditId, marketId, {
      autoCloseOverrideMinutes: null,
    });

    expect(result.status).toBe('open');
    expect(result.metadata?.autoCloseOverrideMinutes).toBeNull();
    expect(schedulerService.cancelMarketClose).toHaveBeenCalledWith(subredditId, marketId);
    expect(schedulerService.scheduleMarketClose).not.toHaveBeenCalled();
    expect(auditService.recordAction).not.toHaveBeenCalled();
  });

  it('closes an open market and cancels outstanding job', async () => {
    const moderatorId = 'mod-33' as UserId;

    const { service, schedulerService, marketRepo, auditService } = setupService({
      marketOverrides: { status: 'open' },
    });

    const result = await service.closeMarket(subredditId, marketId, { moderatorId });

    expect(result.status).toBe('closed');
    expect(result.metadata?.closedBy).toBe(moderatorId);
    expect(result.metadata?.lastClosedAt).toBeDefined();
    expect(result.metadata?.autoClosedByScheduler).toBeUndefined();
    expect(schedulerService.cancelMarketClose).toHaveBeenCalledWith(subredditId, marketId);
    expect(schedulerService.scheduleMarketClose).not.toHaveBeenCalled();

    const savedMarket = (marketRepo.save as VitestMock).mock.calls[0][1] as Market;
    expect(savedMarket.status).toBe('closed');

    expect(auditService.recordAction).toHaveBeenCalledWith(subredditId, {
      performedBy: moderatorId,
      performedByUsername: 'unknown',
      action: 'CLOSE_MARKET',
      marketId,
      payload: { mode: 'manual' },
    });
  });

  it('auto closes an open market during scheduler callback', async () => {
    const { service, schedulerService, marketRepo } = setupService({
      marketOverrides: { status: 'open' },
    });

    const result = await service.autoCloseMarket(subredditId, marketId);

    expect(result.status).toBe('closed');
    expect(result.market?.status).toBe('closed');
    expect(result.market?.metadata?.autoClosedByScheduler).toBe(true);
    expect(result.market?.metadata?.lastAutoClosedAt).toBeDefined();
    expect(schedulerService.cancelMarketClose).toHaveBeenCalledWith(subredditId, marketId);
    const savedMarket = (marketRepo.save as VitestMock).mock.calls[0][1] as Market;
    expect(savedMarket.metadata?.autoClosedByScheduler).toBe(true);
  });

  it('skips scheduler close when market is not open', async () => {
    const { service, schedulerService, marketRepo } = setupService({
      marketOverrides: { status: 'closed' },
    });

    const result = await service.autoCloseMarket(subredditId, marketId);

    expect(result.status).toBe('skipped');
    expect(result.reason).toBe('market_status_closed');
    expect(schedulerService.cancelMarketClose).toHaveBeenCalledWith(subredditId, marketId);
    expect(marketRepo.save).not.toHaveBeenCalled();
  });

  it('skips scheduler close when market is missing', async () => {
    const { service, schedulerService, marketRepo } = setupService();
    (marketRepo.getById as VitestMock).mockResolvedValueOnce(null);

    const result = await service.autoCloseMarket(subredditId, marketId);

    expect(result.status).toBe('skipped');
    expect(result.reason).toBe('not_found');
    expect(schedulerService.cancelMarketClose).toHaveBeenCalledWith(subredditId, marketId);
    expect(marketRepo.save).not.toHaveBeenCalled();
  });
});

describe('MarketsService archive', () => {
  const subredditId = 'sub-1' as SubredditId;
  const moderatorId = 'mod-archive' as UserId;
  const moderatorUsername = 'mod-archive-user';

  it('archives eligible markets before cutoff', async () => {
    const cutoff = new Date('2024-02-01T00:00:00.000Z');
    const settledAt = '2024-01-01T00:00:00.000Z';

    const archivable = createMarket({
      id: 'market-archivable' as MarketId,
      status: 'resolved',
      resolvedAt: settledAt,
      metadata: { lastSettledAt: settledAt },
    });

    const recent = createMarket({
      id: 'market-recent' as MarketId,
      status: 'resolved',
      resolvedAt: '2024-03-01T00:00:00.000Z',
      metadata: { lastSettledAt: '2024-03-01T00:00:00.000Z' },
    });

    const alreadyArchived = createMarket({
      id: 'market-archived' as MarketId,
      status: 'resolved',
      resolvedAt: settledAt,
      metadata: {
        archivedAt: '2024-01-15T00:00:00.000Z',
        lastSettledAt: settledAt,
      },
    });

    const marketsByStatus: Record<MarketStatus, Market[]> = {
      draft: [],
      open: [],
      closed: [],
      resolved: [archivable, recent, alreadyArchived],
      void: [],
    };

    const marketsById = new Map<MarketId, Market>([
      [archivable.id, archivable],
      [recent.id, recent],
      [alreadyArchived.id, alreadyArchived],
    ]);

    const betsForArchivable = [
      createBet({
        id: 'bet-a' as Bet['id'],
        marketId: archivable.id,
        userId: 'user-arch-1' as UserId,
        side: 'yes',
      }),
      createBet({
        id: 'bet-b' as Bet['id'],
        marketId: archivable.id,
        userId: 'user-arch-2' as UserId,
        side: 'no',
      }),
    ];

    const betsByMarket = new Map<MarketId, Bet[]>([[archivable.id, betsForArchivable]]);

    const { service, marketRepo, betRepo, auditService } = setupService({
      marketRepoOverrides: {
        list: vi
          .fn()
          .mockImplementation(async (_sid: SubredditId, opts?: { status?: MarketStatus }) => {
            const status = opts?.status ?? 'resolved';
            const markets = marketsByStatus[status] ?? [];
            return { markets, total: markets.length };
          }),
      },
      betRepoOverrides: {
        listByMarket: vi
          .fn()
          .mockImplementation(async (_sid: SubredditId, marketId: MarketId) => {
            const market = marketsById.get(marketId);
            if (market) {
              updateSettlementState({ market, bets: betsByMarket.get(marketId) ?? [] });
            }
            return betsByMarket.get(marketId) ?? [];
          }),
        delete: vi.fn().mockResolvedValue(undefined),
      },
    });

    const result = await service.archiveMarkets(subredditId, {
      cutoff,
      statuses: ['resolved'],
      moderatorId,
      moderatorUsername,
    });

    expect(result.archivedMarkets).toBe(1);
    expect(result.skippedMarkets).toBe(2);
    expect(result.processedMarkets).toBe(3);
    expect(result.dryRun).toBe(false);
  expect(result.pagination).toEqual({ page: 1, pageSize: 50, total: 1 });
  expect(result.candidates).toHaveLength(1);
  expect(result.candidates[0].id).toBe(archivable.id);

    expect((betRepo.listByMarket as VitestMock)).toHaveBeenCalledTimes(1);
    expect((betRepo.delete as VitestMock)).toHaveBeenCalledTimes(betsForArchivable.length);

    const updatedMarket = (marketRepo.applyUpdate as VitestMock).mock.calls[0][3] as Market;
    expect(updatedMarket.metadata?.archivedBy).toBe(moderatorId);
  expect(updatedMarket.metadata?.archivedByUsername).toBe(moderatorUsername);
    expect(updatedMarket.metadata?.archivedBetCount).toBe(betsForArchivable.length);
    expect(typeof updatedMarket.metadata?.archivedAt).toBe('string');

    expect(runTransactionMock).toHaveBeenCalledTimes(1);

    const auditCalls = (auditService.recordAction as VitestMock).mock.calls.filter(([, input]) => input.action === 'ARCHIVE_MARKETS');
    expect(auditCalls).toHaveLength(1);
    const [, auditInput] = auditCalls[0];
    expect(auditInput.performedBy).toBe(moderatorId);
    expect(auditInput.performedByUsername).toBe(moderatorUsername);
    expect(auditInput.payload).toEqual(
      expect.objectContaining({
        archivedMarketIds: [archivable.id],
        archivedCount: 1,
        processedCount: 3,
        skippedCount: 2,
        statuses: ['resolved'],
        betsArchivedTotal: betsForArchivable.length,
      }),
    );
    expect(auditInput.snapshot?.before).toEqual([
      expect.objectContaining({ id: archivable.id }),
    ]);
    expect(auditInput.snapshot?.after).toEqual([
      expect.objectContaining({
        id: archivable.id,
        metadata: expect.objectContaining({ archivedBetCount: betsForArchivable.length }),
      }),
    ]);
  });

  it('supports dry-run without mutating data', async () => {
    const cutoff = new Date('2024-02-01T00:00:00.000Z');

    const archivable = createMarket({
      id: 'market-dry-run' as MarketId,
      status: 'void',
      metadata: { lastSettledAt: '2024-01-01T00:00:00.000Z' },
    });

    const { service, marketRepo, betRepo, auditService } = setupService({
      marketRepoOverrides: {
        list: vi.fn().mockResolvedValue({ markets: [archivable], total: 1 }),
      },
      betRepoOverrides: {
        listByMarket: vi.fn(),
        delete: vi.fn(),
      },
    });

    const result = await service.archiveMarkets(subredditId, {
      cutoff,
      statuses: ['void'],
      moderatorId,
      moderatorUsername,
      dryRun: true,
    });

    expect(result.archivedMarkets).toBe(1);
    expect(result.skippedMarkets).toBe(0);
    expect(result.processedMarkets).toBe(1);
    expect(result.dryRun).toBe(true);
  expect(result.pagination).toEqual({ page: 1, pageSize: 50, total: 1 });
  expect(result.candidates).toHaveLength(1);
  expect(result.candidates[0].id).toBe(archivable.id);

    expect(betRepo.listByMarket).not.toHaveBeenCalled();
    expect(betRepo.delete).not.toHaveBeenCalled();
    expect(marketRepo.applyUpdate).not.toHaveBeenCalled();
    expect(runTransactionMock).not.toHaveBeenCalled();
    expect(auditService.recordAction).not.toHaveBeenCalled();
  });

  it('obeys maxMarkets across statuses', async () => {
    const cutoff = new Date('2024-02-01T00:00:00.000Z');

    const resolvedMarket = createMarket({
      id: 'market-resolved' as MarketId,
      status: 'resolved',
      resolvedAt: '2024-01-01T00:00:00.000Z',
      metadata: { lastSettledAt: '2024-01-01T00:00:00.000Z' },
    });

    const voidMarket = createMarket({
      id: 'market-void' as MarketId,
      status: 'void',
      metadata: { lastSettledAt: '2024-01-01T00:00:00.000Z' },
    });

    const marketsByStatus: Record<MarketStatus, Market[]> = {
      draft: [],
      open: [],
      closed: [],
      resolved: [resolvedMarket],
      void: [voidMarket],
    };

    const betsByMarket = new Map<MarketId, Bet[]>([
      [resolvedMarket.id, [createBet({ marketId: resolvedMarket.id })]],
      [voidMarket.id, [createBet({ marketId: voidMarket.id })]],
    ]);

    const { service, marketRepo, betRepo, auditService } = setupService({
      marketRepoOverrides: {
        list: vi
          .fn()
          .mockImplementation(async (_sid: SubredditId, opts?: { status?: MarketStatus }) => {
            const status = opts?.status ?? 'resolved';
            const markets = marketsByStatus[status] ?? [];
            return { markets, total: markets.length };
          }),
      },
      betRepoOverrides: {
        listByMarket: vi
          .fn()
          .mockImplementation(async (_sid: SubredditId, marketId: MarketId) => {
            const bets = betsByMarket.get(marketId) ?? [];
            const market = marketsByStatus.resolved
              .concat(marketsByStatus.void)
              .find((candidate) => candidate.id === marketId);
            if (market) {
              updateSettlementState({ market, bets });
            }
            return bets;
          }),
        delete: vi.fn().mockResolvedValue(undefined),
      },
    });

    const result = await service.archiveMarkets(subredditId, {
      cutoff,
      moderatorId,
      moderatorUsername,
      maxMarkets: 1,
    });

    expect(result.archivedMarkets).toBe(1);
    expect(result.processedMarkets).toBe(1);
    expect(result.skippedMarkets).toBe(0);
  expect(result.pagination.total).toBe(1);
  expect(result.candidates).toHaveLength(1);
  expect(result.candidates[0].id).toBe(resolvedMarket.id);

    const statusesQueried = (marketRepo.list as VitestMock).mock.calls.map(([, opts]) => opts?.status);
    expect(statusesQueried).toEqual(['resolved']);

    expect((betRepo.listByMarket as VitestMock)).toHaveBeenCalledTimes(1);
    expect((betRepo.delete as VitestMock)).toHaveBeenCalledTimes(1);
    expect(runTransactionMock).toHaveBeenCalledTimes(1);

    const auditCalls = (auditService.recordAction as VitestMock).mock.calls.filter(([, input]) => input.action === 'ARCHIVE_MARKETS');
    expect(auditCalls).toHaveLength(1);
    const [, auditInput] = auditCalls[0];
    expect(auditInput.payload.archivedMarketIds).toEqual([resolvedMarket.id]);
    expect(auditInput.payload.statuses).toEqual(['resolved', 'void']);
    expect(auditInput.payload.maxMarkets).toBe(1);
  });

  it('records audit action with system actor when moderator context is missing', async () => {
    const cutoff = new Date('2024-02-01T00:00:00.000Z');

    const archivable = createMarket({
      id: 'market-system-archive' as MarketId,
      status: 'resolved',
      resolvedAt: '2023-12-31T00:00:00.000Z',
      metadata: { lastSettledAt: '2023-12-31T00:00:00.000Z' },
    });

    const { service, auditService } = setupService({
      marketRepoOverrides: {
        list: vi.fn().mockResolvedValue({ markets: [archivable], total: 1 }),
      },
      betRepoOverrides: {
        listByMarket: vi.fn().mockResolvedValue([
          createBet({ marketId: archivable.id, userId: 'user-1' as UserId }),
        ]),
        delete: vi.fn().mockResolvedValue(undefined),
      },
    });

    await service.archiveMarkets(subredditId, {
      cutoff,
      statuses: ['resolved'],
      maxMarkets: 5,
    });

    const auditCalls = (auditService.recordAction as VitestMock).mock.calls.filter(([, input]) => input.action === 'ARCHIVE_MARKETS');
    expect(auditCalls).toHaveLength(1);
    const [, auditInput] = auditCalls[0];
    expect(auditInput.performedBy).toBe('system:auto-archive');
    expect(auditInput.performedByUsername).toBe('auto-archive');
    expect(auditInput.payload.actorType).toBe('system');
  });
});
