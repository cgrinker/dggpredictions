import type { MarketId, SubredditId } from '../../shared/types/entities.js';
import { redisClient } from '../redis-client.js';
import { marketKeys } from '../utils/redis-keys.js';

export interface StoredMarketCloseJob {
  readonly jobId: string;
  readonly runAt: string;
}

export class SchedulerRepository {
  async getMarketCloseJob(subredditId: SubredditId, marketId: MarketId): Promise<StoredMarketCloseJob | null> {
    const key = marketKeys.schedulerClose(subredditId, marketId);
    const raw = await redisClient.get(key);
    if (!raw) {
      return null;
    }

    try {
      const parsed = JSON.parse(raw) as StoredMarketCloseJob;
      if (!parsed || typeof parsed.jobId !== 'string' || typeof parsed.runAt !== 'string') {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  async saveMarketCloseJob(
    subredditId: SubredditId,
    marketId: MarketId,
    payload: StoredMarketCloseJob,
  ): Promise<void> {
    const key = marketKeys.schedulerClose(subredditId, marketId);
    await redisClient.set(key, JSON.stringify(payload));
  }

  async deleteMarketCloseJob(subredditId: SubredditId, marketId: MarketId): Promise<void> {
    const key = marketKeys.schedulerClose(subredditId, marketId);
    await redisClient.del(key);
  }
}
