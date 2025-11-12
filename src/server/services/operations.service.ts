import type { SubredditId } from '../../shared/types/entities.js';
import type { IncidentFeed, IncidentSummary, MetricsSummary } from '../../shared/types/dto.js';
import { MarketRepository } from '../repositories/market.repository.js';
import { nowIso } from '../utils/time.js';
import { redisClient } from '../redis-client.js';
import { logger } from '../logging.js';
import type { RedisClient } from '@devvit/redis';

interface IncidentProvider {
  getRecent(subredditId: SubredditId, limit?: number): Promise<readonly IncidentSummary[]>;
}

const INCIDENT_LIMIT = 20;

export class OperationsService {
  private readonly markets: MarketRepository;
  private readonly incidents: IncidentProvider | null;
  private readonly redis: RedisClient;

  constructor(
    markets = new MarketRepository(),
    incidents: IncidentProvider | null = null,
    redis: RedisClient = redisClient,
  ) {
    this.markets = markets;
    this.incidents = incidents;
    this.redis = redis;
  }

  async getMetricsSummary(subredditId: SubredditId): Promise<MetricsSummary> {
    const counts = await this.markets.countByStatus(subredditId);
    const archiveEligible = counts.byStatus.closed + counts.byStatus.resolved + counts.byStatus.void;
    const redisSnapshot = await this.getRedisUsageSnapshot();

    const counters: Record<string, number> = {
      totalMarkets: counts.total,
      draftMarkets: counts.byStatus.draft,
      openMarkets: counts.byStatus.open,
      closedMarkets: counts.byStatus.closed,
      resolvedMarkets: counts.byStatus.resolved,
      voidMarkets: counts.byStatus.void,
      archivableMarkets: archiveEligible,
    };

    if (redisSnapshot) {
      counters.redisUsedMemoryBytes = redisSnapshot.usedMemoryBytes;
      counters.redisPeakMemoryBytes = redisSnapshot.peakMemoryBytes;
      counters.redisTotalKeys = redisSnapshot.totalKeys;
    }

    return {
      counters,
      updatedAt: nowIso(),
    } satisfies MetricsSummary;
  }

  async getIncidentFeed(subredditId: SubredditId): Promise<IncidentFeed> {
    const incidents = this.incidents
      ? await this.incidents.getRecent(subredditId, INCIDENT_LIMIT)
      : [];

    return {
      incidents,
      fetchedAt: nowIso(),
    } satisfies IncidentFeed;
  }

  private async getRedisUsageSnapshot(): Promise<{
    readonly usedMemoryBytes: number;
    readonly peakMemoryBytes: number;
    readonly totalKeys: number;
  } | null> {
    try {
      const redisIntrospection = this.redis as unknown as {
        info?: (section?: string) => Promise<string>;
        dbsize?: () => Promise<number>;
      };

      if (!redisIntrospection.info || !redisIntrospection.dbsize) {
        return null;
      }

      const info = await redisIntrospection.info('memory');
      const usedMemory = this.extractInfoMetric(info, 'used_memory');
      const peakMemory = this.extractInfoMetric(info, 'used_memory_peak');
      const totalKeys = await redisIntrospection.dbsize();

      return {
        usedMemoryBytes: usedMemory ?? 0,
        peakMemoryBytes: peakMemory ?? 0,
        totalKeys,
      };
    } catch (error) {
      logger.warn('failed to read redis usage snapshot', {
        message: error instanceof Error ? error.message : 'unknown error',
      });
      return null;
    }
  }

  private extractInfoMetric(info: string, key: string): number | null {
    const line = info
      .split('\n')
      .map((entry) => entry.trim())
      .find((entry) => entry.startsWith(`${key}:`));
    if (!line) {
      return null;
    }

    const [, raw] = line.split(':', 2);
    if (!raw) {
      return null;
    }

    const value = Number.parseInt(raw, 10);
    return Number.isNaN(value) ? null : value;
  }
}
