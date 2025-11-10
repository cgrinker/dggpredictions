import { redis } from '@devvit/web/server';
import type { RedisClient, TxClientLike } from '@devvit/redis';
import { MAX_TRANSACTION_RETRIES } from '../config/constants.js';
import { logger } from '../logging.js';

export type TransactionHandler<T, TState> = (tx: TxClientLike, state: TState) => Promise<T>;
export type TransactionStateLoader<TState> = (client: RedisClient) => Promise<TState>;

interface TransactionOptions<TState> {
  readonly retries?: number;
  readonly label?: string;
  readonly loadState?: TransactionStateLoader<TState>;
}

export const runTransactionWithRetry = async <T, TState = void>(
  keys: string[],
  handler: TransactionHandler<T, TState>,
  options?: TransactionOptions<TState>
): Promise<T> => {
  const client = redis as unknown as RedisClient;
  const maxRetries = options?.retries ?? MAX_TRANSACTION_RETRIES;
  const label = options?.label ?? 'transaction';

  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    const tx = await client.watch(...keys);

    try {
      const state = options?.loadState ? await options.loadState(client) : (undefined as TState);
      await tx.multi();
      const result = await handler(tx, state);
      const execResult = await tx.exec();

      if (execResult === null || execResult === undefined) {
        throw new Error('transaction aborted due to concurrent modification');
      }

      return result;
    } catch (error) {
      await tx.discard().catch(() => {
        // Safe to ignore discard errors; the transaction already failed.
      });

      if (attempt === maxRetries) {
        logger.error('transaction aborted after retries', { label, attempt, error });
        throw error;
      }

      logger.warn('transaction conflict detected; retrying', { label, attempt, error });
    }
  }

  throw new Error('transaction retry loop exhausted unexpectedly');
};
