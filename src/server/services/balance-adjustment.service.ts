import type { TxClientLike, RedisClient } from '@devvit/redis';
import type {
  Points,
  SubredditId,
  UserBalance,
  UserId,
} from '../../shared/types/entities.js';
import type {
  AdjustBalanceRequest,
  AdjustBalanceResponse,
} from '../../shared/types/dto.js';
import { BalanceRepository } from '../repositories/balance.repository.js';
import { ConfigService } from './config.service.js';
import { LedgerService } from './ledger.service.js';
import { AuditLogService } from './audit-log.service.js';
import { runTransactionWithRetry } from '../utils/transactions.js';
import { balanceKeys } from '../utils/redis-keys.js';
import { deserializeUserBalance } from '../utils/serializers.js';
import { nowIso } from '../utils/time.js';
import { ValidationError } from '../errors.js';

interface AdjustmentState {
  readonly balance: UserBalance;
}

interface AdjustmentResult {
  readonly balance: UserBalance;
  readonly previous: UserBalance;
}

export interface BalanceAdjustmentInput extends AdjustBalanceRequest {
  readonly subredditId: SubredditId;
  readonly targetUserId: UserId;
  readonly moderatorUserId: UserId;
  readonly moderatorUsername: string | null;
}

export class BalanceAdjustmentService {
  private readonly balances: BalanceRepository;
  private readonly config: ConfigService;
  private readonly ledger: LedgerService;
  private readonly audit: AuditLogService;

  constructor(
    balances = new BalanceRepository(),
    config = new ConfigService(),
    ledger = new LedgerService(),
    audit = new AuditLogService(),
  ) {
    this.balances = balances;
    this.config = config;
    this.ledger = ledger;
    this.audit = audit;
  }

  async adjustBalance(input: BalanceAdjustmentInput): Promise<AdjustBalanceResponse> {
    if (input.delta <= 0) {
      throw new ValidationError('Adjustment amount must be greater than zero.');
    }

    const currentBalance = await this.ensureBalanceRecord(input.subredditId, input.targetUserId);

    const key = balanceKeys.record(input.subredditId, input.targetUserId);
    const { balance, previous } = await runTransactionWithRetry<AdjustmentResult, AdjustmentState>(
      [key],
      async (tx, state) => this.applyAdjustment(tx, state.balance, input),
      {
        label: 'balance:adjust',
        loadState: async (client) => this.loadState(client, key, currentBalance),
      },
    );

    const auditAction = await this.audit.recordAction(input.subredditId, {
      performedBy: input.moderatorUserId,
      performedByUsername: input.moderatorUsername ?? 'unknown',
      action: 'ADJUST_BALANCE',
      targetUserId: input.targetUserId,
      payload: {
        delta: input.delta,
        mode: input.mode,
        reasonCode: input.reasonCode,
        ...(input.memo ? { memo: input.memo } : {}),
      },
      snapshot: {
        before: previous,
        after: balance,
      },
    });

    return {
      balance,
      auditAction,
    } satisfies AdjustBalanceResponse;
  }

  private async ensureBalanceRecord(
    subredditId: SubredditId,
    userId: UserId,
  ): Promise<UserBalance> {
    const existing = await this.balances.get(subredditId, userId);
    if (existing) {
      return existing;
    }

    const config = await this.config.getConfig(subredditId);
    if (!config) {
      throw new ValidationError('Subreddit configuration unavailable for balance initialization.');
    }

    const snapshot: UserBalance = {
      schemaVersion: 1,
      userId,
      subredditId,
      balance: config.startingBalance as Points,
      lifetimeEarned: 0 as Points,
      lifetimeLost: 0 as Points,
      weeklyEarned: 0 as Points,
      monthlyEarned: 0 as Points,
      updatedAt: nowIso(),
    };

    return this.balances.create(snapshot);
  }

  private async applyAdjustment(
    tx: TxClientLike,
    current: UserBalance,
    input: BalanceAdjustmentInput,
  ): Promise<AdjustmentResult> {
    const delta = input.delta;
    const isCredit = input.mode === 'credit';
    const change = isCredit ? delta : ((-delta) as Points);
    const nextBalance = current.balance + change;

    if (nextBalance < 0) {
      throw new ValidationError('Adjustment would result in a negative balance.');
    }

    const updated: UserBalance = {
      ...current,
      balance: nextBalance,
      lifetimeEarned: (current.lifetimeEarned + (isCredit ? delta : 0)) as Points,
      lifetimeLost: (current.lifetimeLost + (isCredit ? 0 : delta)) as Points,
      weeklyEarned: (current.weeklyEarned + (isCredit ? delta : 0)) as Points,
      monthlyEarned: (current.monthlyEarned + (isCredit ? delta : 0)) as Points,
      updatedAt: nowIso(),
    };

    await this.balances.applySnapshot(tx, updated);
    await this.ledger.record(tx, {
      subredditId: input.subredditId,
      userId: input.targetUserId,
      marketId: null,
      betId: null,
      type: 'adjustment',
      delta,
      balanceAfter: updated.balance,
      metadata: {
        mode: input.mode,
        reasonCode: input.reasonCode,
        moderatorId: input.moderatorUserId,
        moderatorUsername: input.moderatorUsername ?? 'unknown',
        ...(input.memo ? { memo: input.memo } : {}),
      },
    });

    return {
      balance: updated,
      previous: current,
    };
  }

  private async loadState(
    client: RedisClient,
    key: string,
    fallback: UserBalance,
  ): Promise<AdjustmentState> {
    const hash = await client.hGetAll(key);
    const balance = deserializeUserBalance(hash);
    if (!balance) {
      return { balance: fallback } satisfies AdjustmentState;
    }
    return { balance } satisfies AdjustmentState;
  }
}
