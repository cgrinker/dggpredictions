import type { SubredditId, UserId } from '../../shared/types/entities.js';
import { redisClient } from '../redis-client.js';
import { userDirectoryKeys } from '../utils/redis-keys.js';

export class UserDirectoryRepository {
  async remember(subredditId: SubredditId, userId: UserId, username: string): Promise<void> {
    const normalized = username.trim();
    if (!normalized) {
      return;
    }

    const key = userDirectoryKeys.usernames(subredditId);
    await redisClient.hSet(key, { [userId]: normalized });
  }

  async get(subredditId: SubredditId, userId: UserId): Promise<string | null> {
    const key = userDirectoryKeys.usernames(subredditId);
    const value = await redisClient.hGet(key, userId);
    return value ?? null;
  }

  async getMany(
    subredditId: SubredditId,
    userIds: readonly UserId[],
  ): Promise<Map<UserId, string>> {
    if (userIds.length === 0) {
      return new Map();
    }

    const key = userDirectoryKeys.usernames(subredditId);
    const values = await redisClient.hMGet(key, userIds as unknown as string[]);

    const result = new Map<UserId, string>();
    values.forEach((value, index) => {
      const username = typeof value === 'string' ? value.trim() : '';
      const userId = userIds[index];
      if (username && userId) {
        result.set(userId, username);
      }
    });

    return result;
  }
}
