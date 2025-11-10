import type {
  BetId,
  Market,
  MarketId,
  MarketStatus,
  SubredditId,
  UserId,
} from '../../shared/types/entities.js';
import type { TxClientLike } from '@devvit/redis';
import { redisClient } from '../redis-client.js';
import { marketKeys } from '../utils/redis-keys.js';
import { deserializeMarket, serializeMarket } from '../utils/serializers.js';
import { runTransactionWithRetry } from '../utils/transactions.js';
import { toEpochMillis } from '../utils/time.js';
import { ConflictError, NotFoundError } from '../errors.js';
import type { RedisClient } from '@devvit/redis';

const DEFAULT_PAGE_SIZE = 20;

interface ListMarketsOptions {
  readonly status?: MarketStatus;
  readonly page?: number;
  readonly pageSize?: number;
}

interface ListMarketsResult {
  readonly markets: readonly Market[];
  readonly total: number;
}

interface MarketState {
  readonly market: Market;
}

const scoreForMarket = (market: Market): number => toEpochMillis(market.createdAt);

const pickIndexKey = (subredditId: SubredditId, status?: MarketStatus) =>
  status ? marketKeys.indexByStatus(subredditId, status) : marketKeys.indexAll(subredditId);

export class MarketRepository {
  async getById(subredditId: SubredditId, marketId: MarketId): Promise<Market | null> {
    const key = marketKeys.record(subredditId, marketId);
    const hash = await redisClient.hGetAll(key);
    return deserializeMarket(hash);
  }

  async list(subredditId: SubredditId, options?: ListMarketsOptions): Promise<ListMarketsResult> {
    const page = options?.page ?? 1;
    const pageSize = options?.pageSize ?? DEFAULT_PAGE_SIZE;
    const start = (page - 1) * pageSize;
    const stop = start + pageSize - 1;
    const indexKey = pickIndexKey(subredditId, options?.status);

    const [members, total] = await Promise.all([
      redisClient.zRange(indexKey, start, stop, { by: 'rank' }),
      redisClient.zCard(indexKey),
    ]);

    if (members.length === 0) {
      return { markets: [], total };
    }

    const markets = await Promise.all(
      members.map(async ({ member }) => {
        const market = await this.getById(subredditId, member as MarketId);
        return market;
      }),
    );

    return { markets: markets.filter((market): market is Market => market !== null), total };
  }

  async create(subredditId: SubredditId, market: Market): Promise<Market> {
    const marketKey = marketKeys.record(subredditId, market.id);
    const statusIndex = marketKeys.indexByStatus(subredditId, market.status);
    const allIndex = marketKeys.indexAll(subredditId);

    await runTransactionWithRetry(
      [marketKey],
      async (tx) => {
        await tx.hSet(marketKey, serializeMarket(market));
        const score = scoreForMarket(market);
        await tx.zAdd(allIndex, { score, member: market.id });
        await tx.zAdd(statusIndex, { score, member: market.id });
        return market;
      },
      {
        label: 'market:create',
        loadState: async (client: RedisClient) => {
          const exists = await client.exists(marketKey);
          if (exists > 0) {
            throw new ConflictError(`Market ${market.id} already exists.`);
          }
          return undefined;
        },
      },
    );

    return market;
  }

  async save(subredditId: SubredditId, candidate: Market): Promise<Market> {
    const marketKey = marketKeys.record(subredditId, candidate.id);
    const state = await runTransactionWithRetry<Market, MarketState>(
      [marketKey],
      async (tx, stateInner) => {
        await this.applyUpdate(tx, subredditId, stateInner.market, candidate);
        return candidate;
      },
      {
        label: 'market:save',
        loadState: async (client: RedisClient) => {
          const hash = await client.hGetAll(marketKey);
          const market = deserializeMarket(hash);
          if (!market) {
            throw new NotFoundError(`Market ${candidate.id} not found.`);
          }
          return { market } satisfies MarketState;
        },
      },
    );

    return state;
  }

  async getUserBetPointer(
    subredditId: SubredditId,
    marketId: MarketId,
    userId: UserId,
  ): Promise<BetId | null> {
    const pointerKey = marketKeys.userPointer(subredditId, marketId, userId);
    const value = await redisClient.get(pointerKey);
    return value ? (value as BetId) : null;
  }

  async setUserBetPointer(
    tx: TxClientLike,
    subredditId: SubredditId,
    marketId: MarketId,
    userId: UserId,
    betId: BetId,
  ): Promise<void> {
    const pointerKey = marketKeys.userPointer(subredditId, marketId, userId);
    await tx.set(pointerKey, betId, { nx: true });
  }

  async applyUpdate(
    tx: TxClientLike,
    subredditId: SubredditId,
    previous: Market,
    updated: Market,
  ): Promise<void> {
    const marketKey = marketKeys.record(subredditId, updated.id);
    const allIndex = marketKeys.indexAll(subredditId);
    const score = scoreForMarket(updated);

    await tx.hSet(marketKey, serializeMarket(updated));
    await tx.zAdd(allIndex, { score, member: updated.id });

    if (previous.status !== updated.status) {
      const oldIndex = marketKeys.indexByStatus(subredditId, previous.status);
      await tx.zRem(oldIndex, [updated.id]);
    }

    const currentIndex = marketKeys.indexByStatus(subredditId, updated.status);
    await tx.zAdd(currentIndex, { score, member: updated.id });
  }
}
