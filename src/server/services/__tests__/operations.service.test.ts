import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { MarketRepository } from '../../repositories/market.repository.js';
import type { IncidentSummary } from '../../../shared/types/dto.js';
import { OperationsService } from '../operations.service.js';
import { metricsKeys } from '../../utils/redis-keys.js';
import type { RedisClient } from '@devvit/redis';
import type { SubredditId } from '../../../shared/types/entities.js';

class FakeRedis implements Partial<RedisClient> {
  private readonly hashes = new Map<string, Map<string, string>>();
  private usedMemory = 256_000;
  private peakMemory = 512_000;
  private keyCount = 1_024;

  async hSet(key: string, values: Record<string, unknown>): Promise<number> {
    const bucket = this.hashes.get(key) ?? new Map<string, string>();
    for (const [field, value] of Object.entries(values)) {
      bucket.set(field, String(value));
    }
    this.hashes.set(key, bucket);
    return Object.keys(values).length;
  }

  async hGetAll(key: string): Promise<Record<string, string>> {
    const bucket = this.hashes.get(key);
    if (!bucket) {
      return {};
    }

    const result: Record<string, string> = {};
    for (const [field, value] of bucket.entries()) {
      result[field] = value;
    }
    return result;
  }

  async info(section?: string): Promise<string> {
    if (section !== 'memory') {
      return '';
    }
    return `used_memory:${this.usedMemory}\nused_memory_peak:${this.peakMemory}\n`;
  }

  async dbsize(): Promise<number> {
    return this.keyCount;
  }

  setMemory(used: number, peak: number): void {
    this.usedMemory = used;
    this.peakMemory = peak;
  }

  setKeyCount(total: number): void {
    this.keyCount = total;
  }
}

describe('OperationsService', () => {
  const subredditId: SubredditId = 'sub-123' as SubredditId;
  let marketRepository: { countByStatus: ReturnType<typeof vi.fn> };
  let incidentsProvider: { getRecent: ReturnType<typeof vi.fn> } | null;
  let redis: FakeRedis;
  let service: OperationsService;

  beforeEach(() => {
    marketRepository = {
      countByStatus: vi.fn(),
    };
    incidentsProvider = {
      getRecent: vi.fn(),
    };
    redis = new FakeRedis();
    service = new OperationsService(
      marketRepository as unknown as MarketRepository,
      incidentsProvider as unknown as { getRecent: (sub: string, limit?: number) => Promise<readonly IncidentSummary[]> },
      redis as unknown as RedisClient,
    );
  });

  it('returns cached counters when snapshot is fresh', async () => {
    const countersKey = metricsKeys.counters(subredditId);
    const now = new Date().toISOString();
    await redis.hSet(countersKey, {
      updatedAt: now,
      totalMarkets: 42,
      openMarkets: 10,
      closedMarkets: 5,
      resolvedMarkets: 4,
      draftMarkets: 3,
      voidMarkets: 1,
      archivableMarkets: 9,
      redisTotalKeys: 123,
    });

    const summary = await service.getMetricsSummary(subredditId);

    expect(summary).toEqual({
      counters: {
        totalMarkets: 42,
        openMarkets: 10,
        closedMarkets: 5,
        resolvedMarkets: 4,
        draftMarkets: 3,
        voidMarkets: 1,
        archivableMarkets: 9,
        redisTotalKeys: 123,
      },
      updatedAt: now,
    });
    expect(marketRepository.countByStatus).not.toHaveBeenCalled();
  });

  it('computes counters when cache is stale and persists snapshot', async () => {
    const countersKey = metricsKeys.counters(subredditId);
    const staleIso = new Date(Date.now() - 10 * 60_000).toISOString();
    await redis.hSet(countersKey, {
      updatedAt: staleIso,
      totalMarkets: 1,
    });

    redis.setMemory(1_000_000, 2_000_000);
    redis.setKeyCount(9_999);

    marketRepository.countByStatus.mockResolvedValue({
      total: 50,
      byStatus: {
        draft: 5,
        open: 20,
        closed: 10,
        resolved: 12,
        void: 3,
      },
    });

    const summary = await service.getMetricsSummary(subredditId);

    expect(summary.counters).toEqual({
      totalMarkets: 50,
      draftMarkets: 5,
      openMarkets: 20,
      closedMarkets: 10,
      resolvedMarkets: 12,
      voidMarkets: 3,
      archivableMarkets: 25,
      redisUsedMemoryBytes: 1_000_000,
      redisPeakMemoryBytes: 2_000_000,
      redisTotalKeys: 9_999,
    });
    expect(marketRepository.countByStatus).toHaveBeenCalledWith(subredditId);

    const persisted = await redis.hGetAll(countersKey);
    expect(persisted.totalMarkets).toBe('50');
    expect(persisted.redisTotalKeys).toBe('9999');

    const storageSnapshot = await redis.hGetAll(metricsKeys.storage());
    expect(storageSnapshot.usedMemoryBytes).toBe('1000000');
    expect(storageSnapshot.totalKeys).toBe('9999');
  });

  it('returns cached incident feed when provider unavailable', async () => {
    incidentsProvider = null;
    service = new OperationsService(
      marketRepository as unknown as MarketRepository,
      incidentsProvider,
      redis as unknown as RedisClient,
    );

    const incidentsKey = metricsKeys.incidents(subredditId);
    const now = new Date().toISOString();
    const feed = [
      {
        id: 'incident-1',
        severity: 'info',
        message: 'Cache hydrated',
        createdAt: now,
      },
    ] satisfies readonly IncidentSummary[];

    await redis.hSet(incidentsKey, {
      fetchedAt: now,
      incidents: JSON.stringify(feed),
    });

    const result = await service.getIncidentFeed(subredditId);

    expect(result).toEqual({
      incidents: feed,
      fetchedAt: now,
    });
  });

  it('fetches incidents, persists snapshot, and falls back to empty when provider returns nothing', async () => {
    const now = new Date().toISOString();
    (incidentsProvider as { getRecent: ReturnType<typeof vi.fn> }).getRecent.mockResolvedValue([
      {
        id: 'incident-77',
        severity: 'warning',
        message: 'Scheduler delay detected',
        createdAt: now,
      },
    ] satisfies readonly IncidentSummary[]);

    const result = await service.getIncidentFeed(subredditId);

    expect(result.incidents).toHaveLength(1);
    expect(result.incidents[0]?.id).toBe('incident-77');

    const persisted = await redis.hGetAll(metricsKeys.incidents(subredditId));
    expect(persisted.fetchedAt).toBe(result.fetchedAt);
    expect(typeof persisted.incidents).toBe('string');
  });
});
