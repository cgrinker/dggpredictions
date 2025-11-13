import type {
  BetId,
  LedgerEntryId,
  MarketId,
  ModeratorActionId,
  SubredditId,
  UserId,
} from '../../shared/types/entities.js';
import type { IncidentFeed, IncidentSummary, MetricsSummary, SystemResetResponse } from '../../shared/types/dto.js';
import { MarketRepository } from '../repositories/market.repository.js';
import { nowIso } from '../utils/time.js';
import { redisClient } from '../redis-client.js';
import { logger } from '../logging.js';
import {
  auditKeys,
  balanceKeys,
  betKeys,
  configKeys,
  leaderboardKeys,
  marketKeys,
  metricsKeys,
  userDirectoryKeys,
  userKeys,
  ledgerKeys,
} from '../utils/redis-keys.js';
import type { RedisClient } from '@devvit/redis';
import { DEFAULT_LEADERBOARD_WINDOWS } from '../config/constants.js';
import { AuditLogService } from './audit-log.service.js';

interface IncidentProvider {
  getRecent(subredditId: SubredditId, limit?: number): Promise<readonly IncidentSummary[]>;
}

const INCIDENT_LIMIT = 20;
const COUNTERS_CACHE_TTL_MS = 60_000;
const INCIDENT_CACHE_TTL_MS = 120_000;
const RESET_DELETE_BATCH_SIZE = 25;
const MARKET_STATUS_KEYS = ['draft', 'open', 'closed', 'resolved', 'void'] as const;

interface ResetSystemOptions {
  readonly moderatorId: UserId;
  readonly moderatorUsername: string;
  readonly reason?: string | null;
}

interface ResetDiscovery {
  readonly keys: Set<string>;
  readonly stats: {
    readonly markets: number;
    readonly bets: number;
    readonly users: number;
    readonly ledgerEntries: number;
    readonly auditActions: number;
  };
}

export class OperationsService {
  private readonly markets: MarketRepository;
  private readonly incidents: IncidentProvider | null;
  private readonly redis: RedisClient;
  private readonly audit: AuditLogService;

  constructor(
    markets = new MarketRepository(),
    incidents: IncidentProvider | null = null,
    redis: RedisClient = redisClient,
    audit = new AuditLogService(),
  ) {
    this.markets = markets;
    this.incidents = incidents;
    this.redis = redis;
    this.audit = audit;
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

  async resetSystem(subredditId: SubredditId, options: ResetSystemOptions): Promise<SystemResetResponse> {
    const discovery = await this.discoverResetKeys(subredditId);
    const candidates = Array.from<string>(discovery.keys);
    const { deleted, errors } = await this.deleteKeys(candidates);

    const payload: Record<string, unknown> = {
      attemptedKeys: candidates.length,
      deletedKeys: deleted,
      errors,
      stats: discovery.stats,
      sampleKeys: candidates.slice(0, 10),
    };

    if (options.reason) {
      payload.reason = options.reason;
    }

    await this.audit.recordAction(subredditId, {
      action: 'RESET_SYSTEM',
      performedBy: options.moderatorId,
      performedByUsername: options.moderatorUsername,
      payload,
    });

    logger.warn('system reset executed', {
      subredditId,
      attemptedKeys: candidates.length,
      deletedKeys: deleted,
      errors,
      stats: discovery.stats,
      moderatorId: options.moderatorId,
      moderatorUsername: options.moderatorUsername,
    });

    return {
      attemptedKeys: candidates.length,
      deletedKeys: deleted,
      errors,
    } satisfies SystemResetResponse;
  }

  // Collect subreddit-specific keys using known indexes so we can reset without relying on SCAN.
  private async discoverResetKeys(subredditId: SubredditId): Promise<ResetDiscovery> {
    const keys = new Set<string>();
    const stats = {
      markets: 0,
      bets: 0,
      users: 0,
      ledgerEntries: 0,
      auditActions: 0,
    };

    const addKey = (candidate: string | null | undefined) => {
      if (typeof candidate === 'string' && candidate.length > 0) {
        keys.add(candidate);
      }
    };

    addKey(metricsKeys.counters(subredditId));
    addKey(metricsKeys.incidents(subredditId));
    addKey(configKeys.cache(subredditId));
    addKey(configKeys.override(subredditId));

    const leaderboardUserIds = new Set<UserId>();
    for (const window of DEFAULT_LEADERBOARD_WINDOWS) {
      const leaderboardKey = leaderboardKeys.window(subredditId, window);
      const leaderboardMetaKey = leaderboardKeys.windowMeta(subredditId, window);
      addKey(leaderboardKey);
      addKey(leaderboardMetaKey);

      const members = await this.readSortedSetMembers(leaderboardKey);
      members.forEach((member) => {
        if (member) {
          leaderboardUserIds.add(member as UserId);
        }
      });
    }

    const marketIds = new Set<MarketId>();
    const marketIndexKey = marketKeys.indexAll(subredditId);
    addKey(marketIndexKey);
    addKey(marketKeys.indexByCreatedAt(subredditId));
    for (const status of MARKET_STATUS_KEYS) {
      addKey(marketKeys.indexByStatus(subredditId, status));
    }

    const marketMembers = await this.readSortedSetMembers(marketIndexKey);
    marketMembers.forEach((member) => {
      if (member) {
        marketIds.add(member as MarketId);
      }
    });
    stats.markets = marketIds.size;

    const betIds = new Set<BetId>();
    const userIds = new Set<UserId>();

    for (const marketId of marketIds) {
      addKey(marketKeys.record(subredditId, marketId));
      const betIndexKey = marketKeys.betsIndex(subredditId, marketId);
      addKey(betIndexKey);
      addKey(marketKeys.lock(subredditId, marketId));
      addKey(marketKeys.schedulerClose(subredditId, marketId));

      const marketBetIds = await this.readSortedSetMembers(betIndexKey);
      for (const betIdRaw of marketBetIds) {
        if (!betIdRaw) {
          continue;
        }

        const betId = betIdRaw as BetId;
        if (betIds.has(betId)) {
          continue;
        }

        betIds.add(betId);
        const betKey = betKeys.record(subredditId, betId);
        addKey(betKey);

        try {
          const ownerId = await this.redis.hGet(betKey, 'userId');
          if (typeof ownerId === 'string' && ownerId.length > 0) {
            const userId = ownerId as UserId;
            userIds.add(userId);
            addKey(marketKeys.userPointer(subredditId, marketId, userId));
          }
        } catch (error) {
          logger.warn('failed to read bet owner during reset discovery', {
            subredditId,
            betId,
            message: error instanceof Error ? error.message : 'unknown error',
          });
        }
      }
    }
    stats.bets = betIds.size;

    const directoryKey = userDirectoryKeys.usernames(subredditId);
    addKey(directoryKey);
    try {
      const directory = await this.redis.hGetAll(directoryKey);
      if (directory) {
        for (const userId of Object.keys(directory)) {
          if (userId) {
            userIds.add(userId as UserId);
          }
        }
      }
    } catch (error) {
      logger.warn('failed to read user directory during reset discovery', {
        subredditId,
        message: error instanceof Error ? error.message : 'unknown error',
      });
    }

    leaderboardUserIds.forEach((userId) => {
      if (userId) {
        userIds.add(userId);
      }
    });

    for (const userId of userIds) {
      addKey(balanceKeys.record(subredditId, userId));
      const ledgerIndexKey = balanceKeys.ledgerIndex(subredditId, userId);
      addKey(ledgerIndexKey);
      addKey(userKeys.betsAll(subredditId, userId));
      addKey(userKeys.betsActive(subredditId, userId));

      const ledgerEntryIds = await this.readSortedSetMembers(ledgerIndexKey);
      stats.ledgerEntries += ledgerEntryIds.length;
      for (const entryIdRaw of ledgerEntryIds) {
        if (!entryIdRaw) {
          continue;
        }
        addKey(ledgerKeys.entry(subredditId, entryIdRaw as LedgerEntryId));
      }
    }
    stats.users = userIds.size;

    const auditIndexKey = auditKeys.list(subredditId);
    addKey(auditIndexKey);
    const auditMembers = await this.readSortedSetMembers(auditIndexKey);
    stats.auditActions = auditMembers.length;
    for (const actionIdRaw of auditMembers) {
      if (!actionIdRaw) {
        continue;
      }
      addKey(auditKeys.record(subredditId, actionIdRaw as ModeratorActionId));
    }

    return { keys, stats } satisfies ResetDiscovery;
  }

  private async readSortedSetMembers(key: string): Promise<string[]> {
    try {
      const members = await this.redis.zRange(key, 0, -1, { by: 'rank' });
      if (!Array.isArray(members) || members.length === 0) {
        return [];
      }

      return members
        .map((entry) => {
          if (typeof entry === 'string') {
            return entry;
          }
          if (entry && typeof entry === 'object' && 'member' in entry) {
            const value = (entry as { member: unknown }).member;
            if (typeof value === 'string') {
              return value;
            }
            if (typeof value === 'number') {
              return value.toString();
            }
          }
          return null;
        })
        .filter((value): value is string => typeof value === 'string' && value.length > 0);
    } catch (error) {
      logger.warn('failed to read sorted set during reset discovery', {
        key,
        message: error instanceof Error ? error.message : 'unknown error',
      });
      return [];
    }
  }

  private async deleteKeys(keys: readonly string[]): Promise<{ deleted: number; errors: number }> {
    if (keys.length === 0) {
      return { deleted: 0, errors: 0 };
    }

    const redisAny = this.redis as unknown as {
      del?: (...members: string[]) => Promise<number>;
    };

    if (typeof redisAny.del !== 'function') {
      logger.warn('redis client missing del command for system reset');
      return { deleted: 0, errors: 1 };
    }

    let deleted = 0;
    let errors = 0;

    for (let index = 0; index < keys.length; index += RESET_DELETE_BATCH_SIZE) {
      const batch = keys.slice(index, index + RESET_DELETE_BATCH_SIZE);
      if (batch.length === 0) {
        continue;
      }

      try {
        const removed = await redisAny.del(...batch);
        if (typeof removed === 'number' && Number.isFinite(removed)) {
          deleted += removed;
        }
      } catch (error) {
        errors += 1;
        logger.error('failed to delete keys during system reset', {
          message: error instanceof Error ? error.message : 'unknown error',
          sampleKey: batch[0],
          batchSize: batch.length,
        });
      }
    }

    return { deleted, errors };
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
      const values: Record<string, string> = {
        updatedAt: summary.updatedAt,
      };

      for (const [field, value] of Object.entries(summary.counters)) {
        values[field] = String(value);
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
        usedMemoryBytes: String(snapshot.usedMemoryBytes),
        peakMemoryBytes: String(snapshot.peakMemoryBytes),
        totalKeys: String(snapshot.totalKeys),
      });
    } catch (error) {
      logger.warn('failed to persist redis usage metrics', {
        message: error instanceof Error ? error.message : 'unknown error',
      });
    }
  }
}
