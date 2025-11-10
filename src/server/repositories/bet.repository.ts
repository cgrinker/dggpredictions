import type { Bet, BetId, MarketId, SubredditId, UserId } from '../../shared/types/entities.js';
import type { TxClientLike } from '@devvit/redis';
import { redisClient } from '../redis-client.js';
import { betKeys, marketKeys, userKeys } from '../utils/redis-keys.js';
import { deserializeBet, serializeBet } from '../utils/serializers.js';
import { toEpochMillis } from '../utils/time.js';

export class BetRepository {
  async getById(subredditId: SubredditId, betId: BetId): Promise<Bet | null> {
    const key = betKeys.record(subredditId, betId);
    const hash = await redisClient.hGetAll(key);
    return deserializeBet(hash);
  }

  async countActiveByUser(subredditId: SubredditId, userId: UserId): Promise<number> {
    const key = userKeys.betsIndex(subredditId, userId);
    return redisClient.zCard(key);
  }

  async create(
    tx: TxClientLike,
    subredditId: SubredditId,
    marketId: MarketId,
    bet: Bet,
  ): Promise<void> {
    const betKey = betKeys.record(subredditId, bet.id);
    const betIndex = marketKeys.betsIndex(subredditId, marketId);
    const userIndex = userKeys.betsIndex(subredditId, bet.userId);
    await tx.hSet(betKey, serializeBet(bet));
    await tx.zAdd(betIndex, { score: toEpochMillis(bet.createdAt), member: bet.id });
    await tx.zAdd(userIndex, { score: toEpochMillis(bet.createdAt), member: bet.id });
  }

  async update(
    tx: TxClientLike,
    subredditId: SubredditId,
    previous: Bet,
    updated: Bet,
  ): Promise<void> {
    const betKey = betKeys.record(subredditId, updated.id);
    await tx.hSet(betKey, serializeBet(updated));

    if (previous.status === 'active' && updated.status !== 'active') {
      const userIndex = userKeys.betsIndex(subredditId, updated.userId);
      await tx.zRem(userIndex, [updated.id]);
    }
  }
}
