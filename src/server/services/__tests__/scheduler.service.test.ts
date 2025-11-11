import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { MarketId, SubredditId } from '../../../shared/types/entities.js';
import { SchedulerService } from '../scheduler.service.js';
import type { SchedulerRepository, StoredMarketCloseJob } from '../../repositories/scheduler.repository.js';
import type { SchedulerClient } from '@devvit/scheduler';

const createSchedulerClient = () => ({
  runJob: vi.fn<SchedulerClient['runJob']>(),
  cancelJob: vi.fn<SchedulerClient['cancelJob']>(),
  listJobs: vi.fn(),
});

const createRepository = () => ({
  getMarketCloseJob: vi.fn<SchedulerRepository['getMarketCloseJob']>(),
  saveMarketCloseJob: vi.fn<SchedulerRepository['saveMarketCloseJob']>(),
  deleteMarketCloseJob: vi.fn<SchedulerRepository['deleteMarketCloseJob']>(),
});

describe('SchedulerService', () => {
  const subredditId = 'sub-123' as SubredditId;
  const marketId = 'market-777' as MarketId;
  const runAt = new Date('2025-11-11T12:00:00.000Z');

  let schedulerClient: ReturnType<typeof createSchedulerClient>;
  let repository: ReturnType<typeof createRepository>;
  let service: SchedulerService;

  beforeEach(() => {
    schedulerClient = createSchedulerClient();
    repository = createRepository();
    schedulerClient.runJob.mockResolvedValue('job-abc');
    repository.getMarketCloseJob.mockResolvedValue(null);
    repository.saveMarketCloseJob.mockResolvedValue(undefined);
    repository.deleteMarketCloseJob.mockResolvedValue(undefined);

    service = new SchedulerService(
      schedulerClient as unknown as SchedulerClient,
      repository as unknown as SchedulerRepository,
    );
  });

  it('schedules market close job and persists metadata', async () => {
    await service.scheduleMarketClose(subredditId, marketId, { runAt });

    expect(repository.getMarketCloseJob).toHaveBeenCalledWith(subredditId, marketId);
    expect(schedulerClient.cancelJob).not.toHaveBeenCalled();
    expect(schedulerClient.runJob).toHaveBeenCalledWith({
      name: 'market-close',
      runAt,
      data: { subredditId, marketId },
    });

    expect(repository.saveMarketCloseJob).toHaveBeenCalledWith(subredditId, marketId, {
      jobId: 'job-abc',
      runAt: runAt.toISOString(),
    });
  });

  it('cancels existing job before scheduling new one', async () => {
    const existingJob: StoredMarketCloseJob = { jobId: 'job-old', runAt: '2025-11-10T00:00:00.000Z' };
    repository.getMarketCloseJob.mockResolvedValue(existingJob);

    await service.scheduleMarketClose(subredditId, marketId, { runAt });

    expect(schedulerClient.cancelJob).toHaveBeenCalledWith('job-old');
    expect(repository.deleteMarketCloseJob).toHaveBeenCalledWith(subredditId, marketId);
    expect(repository.saveMarketCloseJob).toHaveBeenCalledWith(subredditId, marketId, expect.any(Object));
  });

  it('cancels tracked job when requested directly', async () => {
    const existingJob: StoredMarketCloseJob = { jobId: 'job-old', runAt: '2025-11-10T00:00:00.000Z' };
    repository.getMarketCloseJob.mockResolvedValue(existingJob);

    await service.cancelMarketClose(subredditId, marketId);

    expect(schedulerClient.cancelJob).toHaveBeenCalledWith('job-old');
    expect(repository.deleteMarketCloseJob).toHaveBeenCalledWith(subredditId, marketId);
  });

  it('returns null when no job is persisted', async () => {
    repository.getMarketCloseJob.mockResolvedValue(null);

    const result = await service.getMarketCloseJob(subredditId, marketId);

    expect(result).toBeNull();
  });
});
