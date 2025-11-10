import type { Points, SubredditId, UserBalance, UserId } from '../../shared/types/entities.js';
import type { TxClientLike } from '@devvit/redis';
import { redisClient } from '../redis-client.js';
import { balanceKeys } from '../utils/redis-keys.js';
import { deserializeUserBalance, serializeUserBalance } from '../utils/serializers.js';
import { runTransactionWithRetry } from '../utils/transactions.js';
import { ConflictError, NotFoundError } from '../errors.js';
import type { RedisClient } from '@devvit/redis';

interface BalanceState {
  readonly balance: UserBalance;
}

export class BalanceRepository {
  async get(subredditId: SubredditId, userId: UserId): Promise<UserBalance | null> {
    const key = balanceKeys.record(subredditId, userId);
    const hash = await redisClient.hGetAll(key);
    return deserializeUserBalance(hash);
  }

  async create(initialBalance: UserBalance): Promise<UserBalance> {
    const key = balanceKeys.record(initialBalance.subredditId, initialBalance.userId);

    await runTransactionWithRetry(
      [key],
      async (tx) => {
        await tx.hSet(key, serializeUserBalance(initialBalance));
        return initialBalance;
      },
      {
        label: 'balance:create',
        loadState: async (client: RedisClient) => {
          const exists = await client.exists(key);
          if (exists > 0) {
            throw new ConflictError(`Balance for ${initialBalance.userId} already exists.`);
          }
          return undefined;
        },
      },
    );

    return initialBalance;
  }

  async save(updated: UserBalance): Promise<UserBalance> {
    const key = balanceKeys.record(updated.subredditId, updated.userId);

    const result = await runTransactionWithRetry<UserBalance, BalanceState>(
      [key],
      async (tx) => {
        await tx.hSet(key, serializeUserBalance(updated));
        return updated;
      },
      {
        label: 'balance:save',
        loadState: async (client) => {
          const hash = await client.hGetAll(key);
          const current = deserializeUserBalance(hash);
          if (!current) {
            throw new NotFoundError(`Balance for ${updated.userId} not found.`);
          }
          return { balance: current };
        },
      },
    );

    return result;
  }

  async decrement(
    tx: TxClientLike,
    subredditId: SubredditId,
    userId: UserId,
    field: 'balance' | 'lifetimeLost' | 'weeklyEarned' | 'monthlyEarned',
    amount: Points,
  ): Promise<void> {
    const key = balanceKeys.record(subredditId, userId);
    await tx.hIncrBy(key, field, -amount);
  }

  async increment(
    tx: TxClientLike,
    subredditId: SubredditId,
    userId: UserId,
    field: 'balance' | 'lifetimeEarned' | 'weeklyEarned' | 'monthlyEarned',
    amount: Points,
  ): Promise<void> {
    const key = balanceKeys.record(subredditId, userId);
    await tx.hIncrBy(key, field, amount);
  }

  async applySnapshot(tx: TxClientLike, snapshot: UserBalance): Promise<void> {
    const key = balanceKeys.record(snapshot.subredditId, snapshot.userId);
    await tx.hSet(key, serializeUserBalance(snapshot));
  }
}
