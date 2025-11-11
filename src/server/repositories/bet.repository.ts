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
    const key = userKeys.betsActive(subredditId, userId);
    return redisClient.zCard(key);
  }

  async countAllByUser(subredditId: SubredditId, userId: UserId): Promise<number> {
    const key = userKeys.betsAll(subredditId, userId);
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
    const userAllIndex = userKeys.betsAll(subredditId, bet.userId);
    const userActiveIndex = userKeys.betsActive(subredditId, bet.userId);
    await tx.hSet(betKey, serializeBet(bet));
    await tx.zAdd(betIndex, { score: toEpochMillis(bet.createdAt), member: bet.id });
    await tx.zAdd(userAllIndex, { score: toEpochMillis(bet.createdAt), member: bet.id });
    await tx.zAdd(userActiveIndex, { score: toEpochMillis(bet.createdAt), member: bet.id });
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
      const userActiveIndex = userKeys.betsActive(subredditId, updated.userId);
      await tx.zRem(userActiveIndex, [updated.id]);
    }

    if (previous.status !== 'active' && updated.status === 'active') {
      const userActiveIndex = userKeys.betsActive(subredditId, updated.userId);
      await tx.zAdd(userActiveIndex, { score: toEpochMillis(updated.createdAt), member: updated.id });
    }
  }

  async delete(tx: TxClientLike, subredditId: SubredditId, bet: Bet): Promise<void> {
    const betKey = betKeys.record(subredditId, bet.id);
    const marketIndex = marketKeys.betsIndex(subredditId, bet.marketId);
    const userAllIndex = userKeys.betsAll(subredditId, bet.userId);
    const userActiveIndex = userKeys.betsActive(subredditId, bet.userId);

    await tx.del(betKey);
    await tx.zRem(marketIndex, [bet.id]);
    await tx.zRem(userAllIndex, [bet.id]);

    if (bet.status === 'active') {
      await tx.zRem(userActiveIndex, [bet.id]);
    }
  }

  async listByUser(
    subredditId: SubredditId,
    userId: UserId,
    options?: { readonly offset?: number; readonly limit?: number; readonly status?: Bet['status'] },
  ): Promise<Bet[]> {
    const index = userKeys.betsAll(subredditId, userId);
    const offset = options?.offset ?? 0;
    const limit = options?.limit ?? 50;
    const start = offset;
    const stop = offset + limit - 1;

    const members = await redisClient.zRange(index, start, stop, { by: 'rank' });
    if (members.length === 0) {
      return [];
    }

    const bets = await Promise.all(
      members
        .map(({ member }) => member)
        .map(async (betId) => this.getById(subredditId, betId as BetId)),
    );

    const filtered = bets.filter((bet): bet is Bet => bet !== null);
    if (options?.status) {
      return filtered.filter((bet) => bet.status === options.status);
    }

    return filtered;
  }

  async listByMarket(subredditId: SubredditId, marketId: MarketId): Promise<Bet[]> {
    const index = marketKeys.betsIndex(subredditId, marketId);
    const members = await redisClient.zRange(index, 0, -1, { by: 'rank' });
    if (members.length === 0) {
      return [];
    }

    const bets = await Promise.all(
      members
        .map(({ member }) => member)
        .map(async (betId) => this.getById(subredditId, betId as BetId)),
    );

    return bets.filter((bet): bet is Bet => bet !== null);
  }
}
