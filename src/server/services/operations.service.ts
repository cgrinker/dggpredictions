import type { SubredditId } from '../../shared/types/entities.js';
import type { IncidentFeed, IncidentSummary, MetricsSummary } from '../../shared/types/dto.js';
import { MarketRepository } from '../repositories/market.repository.js';
import { nowIso } from '../utils/time.js';
import { redisClient } from '../redis-client.js';
import { logger } from '../logging.js';
import { metricsKeys } from '../utils/redis-keys.js';
import type { RedisClient } from '@devvit/redis';

interface IncidentProvider {
  getRecent(subredditId: SubredditId, limit?: number): Promise<readonly IncidentSummary[]>;
}

const INCIDENT_LIMIT = 20;
const COUNTERS_CACHE_TTL_MS = 60_000;
const INCIDENT_CACHE_TTL_MS = 120_000;

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
    const cached = await this.loadCachedCounters(subredditId);
    if (cached) {
      return cached;
    }

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

      await this.persistRedisUsage(redisSnapshot);
    }

    const summary: MetricsSummary = {
      counters,
      updatedAt: nowIso(),
    };

    await this.persistCounters(subredditId, summary);
    return summary;
  }

  async getIncidentFeed(subredditId: SubredditId): Promise<IncidentFeed> {
    const cached = await this.loadCachedIncidentFeed(subredditId);
    if (cached) {
      return cached;
    }

    let incidents: readonly IncidentSummary[] = [];
    if (this.incidents) {
      try {
        incidents = await this.incidents.getRecent(subredditId, INCIDENT_LIMIT);
      } catch (error) {
        logger.warn('failed to load incident feed; falling back to cache', {
          subredditId,
          message: error instanceof Error ? error.message : 'unknown error',
        });
      }
    }

    const feed: IncidentFeed = {
      incidents,
      fetchedAt: nowIso(),
    };

    await this.persistIncidentFeed(subredditId, feed);
    return feed;
  }

  private isCacheFresh(timestampIso: string | undefined, ttlMs: number): boolean {
    if (!timestampIso) {
      return false;
    }

    const parsed = Date.parse(timestampIso);
    if (Number.isNaN(parsed)) {
      return false;
    }

    return Date.now() - parsed <= ttlMs;
  }

  private async loadCachedCounters(subredditId: SubredditId): Promise<MetricsSummary | null> {
    try {
      const key = metricsKeys.counters(subredditId);
      const payload = await this.redis.hGetAll(key);
      if (!payload || Object.keys(payload).length === 0) {
        return null;
      }

      const updatedAt = payload.updatedAt;
      if (!this.isCacheFresh(typeof updatedAt === 'string' ? updatedAt : undefined, COUNTERS_CACHE_TTL_MS)) {
        return null;
      }

      const counters: Record<string, number> = {};
      for (const [field, raw] of Object.entries(payload)) {
        if (field === 'updatedAt') {
          continue;
        }

        const parsed = Number.parseInt(String(raw), 10);
        counters[field] = Number.isNaN(parsed) ? 0 : parsed;
      }

      return {
        counters,
        updatedAt: String(updatedAt),
      } satisfies MetricsSummary;
    } catch (error) {
      logger.warn('failed to load cached metrics counters', {
        subredditId,
        message: error instanceof Error ? error.message : 'unknown error',
      });
      return null;
    }
  }

  private async persistCounters(subredditId: SubredditId, summary: MetricsSummary): Promise<void> {
    try {
      const key = metricsKeys.counters(subredditId);
      const values: Record<string, string | number> = {
        updatedAt: summary.updatedAt,
      };

      for (const [field, value] of Object.entries(summary.counters)) {
        values[field] = value;
      }

      await this.redis.hSet(key, values);
    } catch (error) {
      logger.warn('failed to persist metrics counters snapshot', {
        subredditId,
        message: error instanceof Error ? error.message : 'unknown error',
      });
    }
  }

  private async loadCachedIncidentFeed(subredditId: SubredditId): Promise<IncidentFeed | null> {
    try {
      const key = metricsKeys.incidents(subredditId);
      const payload = await this.redis.hGetAll(key);
      if (!payload || Object.keys(payload).length === 0) {
        return null;
      }

      const fetchedAt = payload.fetchedAt;
      if (!this.isCacheFresh(typeof fetchedAt === 'string' ? fetchedAt : undefined, INCIDENT_CACHE_TTL_MS)) {
        return null;
      }

      let incidents: readonly IncidentSummary[] = [];
      if (typeof payload.incidents === 'string' && payload.incidents.length > 0) {
        try {
          incidents = JSON.parse(payload.incidents) as IncidentSummary[];
        } catch (error) {
          logger.warn('failed to parse cached incident payload', {
            subredditId,
            message: error instanceof Error ? error.message : 'unknown error',
          });
          return null;
        }
      }

      return {
        incidents,
        fetchedAt: String(fetchedAt),
      } satisfies IncidentFeed;
    } catch (error) {
      logger.warn('failed to load cached incident feed', {
        subredditId,
        message: error instanceof Error ? error.message : 'unknown error',
      });
      return null;
    }
  }

  private async persistIncidentFeed(subredditId: SubredditId, feed: IncidentFeed): Promise<void> {
    try {
      const key = metricsKeys.incidents(subredditId);
      await this.redis.hSet(key, {
        fetchedAt: feed.fetchedAt,
        incidents: JSON.stringify(feed.incidents),
      });
    } catch (error) {
      logger.warn('failed to persist incident feed snapshot', {
        subredditId,
        message: error instanceof Error ? error.message : 'unknown error',
      });
    }
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

  private async persistRedisUsage(snapshot: {
    readonly usedMemoryBytes: number;
    readonly peakMemoryBytes: number;
    readonly totalKeys: number;
  }): Promise<void> {
    try {
      const key = metricsKeys.storage();
      await this.redis.hSet(key, {
        updatedAt: nowIso(),
        usedMemoryBytes: snapshot.usedMemoryBytes,
        peakMemoryBytes: snapshot.peakMemoryBytes,
        totalKeys: snapshot.totalKeys,
      });
    } catch (error) {
      logger.warn('failed to persist redis usage metrics', {
        message: error instanceof Error ? error.message : 'unknown error',
      });
    }
  }
}
