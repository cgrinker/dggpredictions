import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  Points,
  SubredditId,
  UserBalance,
  UserId,
} from '../../../shared/types/entities.js';
import type { BalanceRepository } from '../../repositories/balance.repository.js';
import type { ConfigService } from '../config.service.js';
import type { LedgerService } from '../ledger.service.js';
import type { AuditLogService } from '../audit-log.service.js';

const runTransactionMock = vi.fn();

type VitestMock = ReturnType<typeof vi.fn>;

type MockedRepos = {
  balanceRepo: Partial<BalanceRepository>;
  configService: Partial<ConfigService>;
  ledgerService: Partial<LedgerService>;
  auditService: Partial<AuditLogService>;
};

vi.mock('../../utils/transactions.js', () => ({
  runTransactionWithRetry: (...args: unknown[]) => runTransactionMock(...args),
}));

let ServiceClass: typeof import('../balance-adjustment.service.js').BalanceAdjustmentService;

const createBalance = (overrides: Partial<UserBalance> = {}): UserBalance => ({
  schemaVersion: 1,
  userId: 'user-1' as UserId,
  subredditId: 'sub-1' as SubredditId,
  balance: 1_000 as Points,
  lifetimeEarned: 500 as Points,
  lifetimeLost: 100 as Points,
  weeklyEarned: 250 as Points,
  monthlyEarned: 300 as Points,
  updatedAt: new Date().toISOString(),
  ...overrides,
});

beforeAll(async () => {
  ({ BalanceAdjustmentService: ServiceClass } = await import('../balance-adjustment.service.js'));
});

beforeEach(() => {
  vi.clearAllMocks();

  runTransactionMock.mockImplementation(async (_keys, handler, options) => {
    const fakeTx = {
      hSet: vi.fn().mockResolvedValue(undefined),
    };

    const fakeClient = {
      hGetAll: vi.fn().mockResolvedValue({}),
    } as unknown as Parameters<NonNullable<typeof options>['loadState']>[0];

    const state = options?.loadState
      ? await options.loadState(fakeClient)
      : { balance: createBalance() };
    return handler(fakeTx, state);
  });
});

const setup = () => {
  const balance = createBalance();

  const balanceRepo: MockedRepos['balanceRepo'] = {
    get: vi.fn().mockResolvedValue(balance),
    create: vi.fn().mockResolvedValue(balance),
    applySnapshot: vi.fn().mockResolvedValue(undefined),
  };

  const configService: MockedRepos['configService'] = {
    getConfig: vi.fn().mockResolvedValue(null),
  };

  const ledgerService: MockedRepos['ledgerService'] = {
    record: vi.fn().mockResolvedValue({
      schemaVersion: 1,
      id: 'ledger-1',
      userId: balance.userId,
      subredditId: balance.subredditId,
      marketId: null,
      betId: null,
      type: 'adjustment',
      delta: 0,
      balanceAfter: balance.balance,
      createdAt: new Date().toISOString(),
      metadata: {},
    }),
  };

  const auditService: MockedRepos['auditService'] = {
    recordAction: vi.fn().mockResolvedValue({
      schemaVersion: 1,
      id: 'audit-1',
      subredditId: balance.subredditId,
      performedBy: 'mod-1' as UserId,
      performedByUsername: 'mod-user',
      action: 'ADJUST_BALANCE',
      marketId: null,
      targetUserId: balance.userId,
      payload: {},
      createdAt: new Date().toISOString(),
    }),
  };

  const service = new ServiceClass(
    balanceRepo as BalanceRepository,
    configService as ConfigService,
    ledgerService as LedgerService,
    auditService as AuditLogService,
  );

  return {
    service,
    balance,
    balanceRepo,
    ledgerService,
    auditService,
  };
};

describe('BalanceAdjustmentService', () => {
  it('credits a balance and records audit metadata', async () => {
    const { service, balance, balanceRepo, ledgerService, auditService } = setup();

    const result = await service.adjustBalance({
      subredditId: balance.subredditId,
      targetUserId: balance.userId,
      moderatorUserId: 'mod-1' as UserId,
      moderatorUsername: 'mod-user',
      delta: 250 as Points,
      mode: 'credit',
      reasonCode: 'BUG_FIX',
      memo: 'Restored lost points',
    });

    expect(result.balance.balance).toBe(balance.balance + 250);
    expect(result.balance.lifetimeEarned).toBe(balance.lifetimeEarned + 250);
    expect(result.balance.lifetimeLost).toBe(balance.lifetimeLost);
    expect(result.balance.weeklyEarned).toBe(balance.weeklyEarned + 250);

    expect(balanceRepo.applySnapshot as VitestMock).toHaveBeenCalledTimes(1);
    const snapshot = (balanceRepo.applySnapshot as VitestMock).mock.calls[0][1] as UserBalance;
    expect(snapshot.balance).toBe(result.balance.balance);

    expect(ledgerService.record as VitestMock).toHaveBeenCalledWith(expect.anything(), {
      subredditId: balance.subredditId,
      userId: balance.userId,
      marketId: null,
      betId: null,
      type: 'adjustment',
      delta: 250,
      balanceAfter: balance.balance + 250,
      metadata: expect.objectContaining({
        mode: 'credit',
        reasonCode: 'BUG_FIX',
        memo: 'Restored lost points',
      }),
    });

    expect(auditService.recordAction as VitestMock).toHaveBeenCalledWith(balance.subredditId, {
      performedBy: 'mod-1',
      performedByUsername: 'mod-user',
      action: 'ADJUST_BALANCE',
      targetUserId: balance.userId,
      payload: expect.objectContaining({ delta: 250, mode: 'credit', reasonCode: 'BUG_FIX' }),
      snapshot: expect.objectContaining({
        before: balance,
        after: expect.objectContaining({ balance: balance.balance + 250 }),
      }),
    });
  });

  it('fails when debit would create negative balance', async () => {
    const { service, balance } = setup();

    await expect(
      service.adjustBalance({
        subredditId: balance.subredditId,
        targetUserId: balance.userId,
        moderatorUserId: 'mod-1' as UserId,
        moderatorUsername: 'mod-user',
        delta: (balance.balance + 1) as Points,
        mode: 'debit',
        reasonCode: 'OTHER',
      }),
    ).rejects.toThrow('Adjustment would result in a negative balance.');
  });
});
