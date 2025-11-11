import type { MarketId, SubredditId } from '../../shared/types/entities.js';
import { scheduler, type SchedulerClient } from '@devvit/scheduler';
import { SchedulerRepository, type StoredMarketCloseJob } from '../repositories/scheduler.repository.js';
import { logger } from '../logging.js';

export interface ScheduleMarketCloseOptions {
  readonly runAt: Date;
}

export class SchedulerService {
  private readonly schedulerClient: SchedulerClient;
  private readonly repository: SchedulerRepository;

  constructor(schedulerClient = scheduler, repository = new SchedulerRepository()) {
    this.schedulerClient = schedulerClient;
    this.repository = repository;
  }

  async scheduleMarketClose(
    subredditId: SubredditId,
    marketId: MarketId,
    options: ScheduleMarketCloseOptions,
  ): Promise<string> {
    await this.cancelMarketClose(subredditId, marketId);

    const jobId = await this.schedulerClient.runJob({
      name: 'market-close',
      runAt: options.runAt,
      data: { subredditId, marketId },
    });

    const payload: StoredMarketCloseJob = {
      jobId,
      runAt: options.runAt.toISOString(),
    };

    await this.repository.saveMarketCloseJob(subredditId, marketId, payload);
    logger.info('scheduled market close job', {
      subredditId,
      marketId,
      jobId,
      runAt: payload.runAt,
    });

    return jobId;
  }

  async cancelMarketClose(subredditId: SubredditId, marketId: MarketId): Promise<void> {
    const existing = await this.repository.getMarketCloseJob(subredditId, marketId);
    if (!existing) {
      return;
    }

    try {
      await this.schedulerClient.cancelJob(existing.jobId);
    } catch (error) {
      logger.warn('failed to cancel scheduler job', {
        subredditId,
        marketId,
        jobId: existing.jobId,
        message: error instanceof Error ? error.message : 'unknown error',
      });
    }

    await this.repository.deleteMarketCloseJob(subredditId, marketId);
    logger.info('cleared market close job', {
      subredditId,
      marketId,
      jobId: existing.jobId,
    });
  }

  async getMarketCloseJob(
    subredditId: SubredditId,
    marketId: MarketId,
  ): Promise<StoredMarketCloseJob | null> {
    return this.repository.getMarketCloseJob(subredditId, marketId);
  }
}
