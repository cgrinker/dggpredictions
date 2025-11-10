import type { TxClientLike } from '@devvit/redis';
import type { LeaderboardEntry, Points, SubredditId, UserId } from '../../shared/types/entities.js';
import type { LeaderboardWindow } from '../config/constants.js';
import { redisClient } from '../redis-client.js';
import { leaderboardKeys } from '../utils/redis-keys.js';

interface ListOptions {
  readonly offset?: number;
  readonly limit?: number;
}

interface LeaderboardMeta {
  readonly username?: string;
  readonly delta?: Points;
}

const parseMeta = (raw: string | null | undefined): LeaderboardMeta => {
  if (!raw) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw) as LeaderboardMeta;
    return parsed ?? {};
  } catch {
    return {};
  }
};

const serializeMeta = (meta: LeaderboardMeta | undefined): string | null => {
  if (!meta) {
    return null;
  }

  const payload: Record<string, unknown> = {};

  if (meta.username) {
    payload.username = meta.username;
  }

  if (typeof meta.delta === 'number' && meta.delta >= 0) {
    payload.delta = Math.trunc(meta.delta);
  }

  if (Object.keys(payload).length === 0) {
    return null;
  }

  try {
    return JSON.stringify(payload);
  } catch {
    return null;
  }
};

const toPoints = (value: number | string | null | undefined): Points => {
  const numeric = typeof value === 'string' ? Number.parseFloat(value) : value;
  if (typeof numeric === 'number' && Number.isFinite(numeric)) {
    return Math.trunc(numeric) as Points;
  }
  return 0 as Points;
};

export class LeaderboardRepository {
  async increment(
    tx: TxClientLike,
    subredditId: SubredditId,
    window: LeaderboardWindow,
    userId: UserId,
    amount: Points,
    metadata?: LeaderboardMeta,
  ): Promise<void> {
    const incrementBy = Math.trunc(amount);
    if (incrementBy <= 0) {
      return;
    }

    const key = leaderboardKeys.window(subredditId, window);
    const metaKey = leaderboardKeys.windowMeta(subredditId, window);

    await tx.zIncrBy(key, userId, incrementBy);

    const serializedMeta = serializeMeta(metadata);
    if (serializedMeta) {
      await tx.hSet(metaKey, { [userId]: serializedMeta });
    }
  }

  async list(
    subredditId: SubredditId,
    window: LeaderboardWindow,
    options?: ListOptions,
  ): Promise<LeaderboardEntry[]> {
    const key = leaderboardKeys.window(subredditId, window);
    const metaKey = leaderboardKeys.windowMeta(subredditId, window);
    const offset = Math.max(0, options?.offset ?? 0);
    const limit = Math.max(1, options?.limit ?? 25);

    const total = await redisClient.zCard(key);
    if (total === 0 || offset >= total) {
      return [];
    }

    const startAsc = Math.max(0, total - offset - limit);
    const stopAsc = total - offset - 1;
    if (startAsc > stopAsc) {
      return [];
    }

    const membersAsc = await redisClient.zRange(key, startAsc, stopAsc, {
      by: 'rank',
    });
    const members = membersAsc.reverse();

    const metas = await Promise.all(members.map(({ member }) => redisClient.hGet(metaKey, member)));

    return members.map(({ member, score }, index) => {
      const userId = member as UserId;
      const meta = parseMeta(metas[index]);
      const leaderboardEntry: LeaderboardEntry = {
        userId,
        username: meta.username ?? `user:${userId}`,
        rank: offset + index + 1,
        score: toPoints(score),
        ...(meta.delta !== undefined ? { delta: toPoints(meta.delta) } : {}),
      };
      return leaderboardEntry;
    });
  }

  async getUser(
    subredditId: SubredditId,
    window: LeaderboardWindow,
    userId: UserId,
  ): Promise<LeaderboardEntry | null> {
    const key = leaderboardKeys.window(subredditId, window);
    const metaKey = leaderboardKeys.windowMeta(subredditId, window);

    const [total, rankAsc] = await Promise.all([
      redisClient.zCard(key),
      redisClient.zRank(key, userId),
    ]);

    if (typeof rankAsc !== 'number' || total === 0) {
      return null;
    }

    const [score, metaRaw] = await Promise.all([
      redisClient.zScore(key, userId),
      redisClient.hGet(metaKey, userId),
    ]);

    const meta = parseMeta(metaRaw);
    const leaderboardEntry: LeaderboardEntry = {
      userId,
      username: meta.username ?? `user:${userId}`,
      rank: total - rankAsc,
      score: toPoints(score),
      ...(meta.delta !== undefined ? { delta: toPoints(meta.delta) } : {}),
    };

    return leaderboardEntry;
  }
}
