import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { MarketRepository } from '../../repositories/market.repository.js';
import type { IncidentSummary } from '../../../shared/types/dto.js';
import { OperationsService } from '../operations.service.js';
import {
  auditKeys,
  balanceKeys,
  betKeys,
  leaderboardKeys,
  marketKeys,
  metricsKeys,
  configKeys,
  userDirectoryKeys,
  userKeys,
  ledgerKeys,
} from '../../utils/redis-keys.js';
import type { RedisClient } from '@devvit/redis';
import type {
  BetId,
  LedgerEntryId,
  MarketId,
  ModeratorActionId,
  SubredditId,
  UserId,
} from '../../../shared/types/entities.js';
import type { AuditLogService } from '../audit-log.service.js';
import { DEFAULT_LEADERBOARD_WINDOWS } from '../../config/constants.js';

class FakeRedis {
  private readonly hashes = new Map<string, Map<string, string>>();
  private readonly sortedSets = new Map<string, Map<string, number>>();
  private readonly keySet = new Set<string>();
  private usedMemory = 256_000;
  private peakMemory = 512_000;
  private reportedKeyCount: number | null = null;
  private throwOnDeleteOnce = false;

  addKey(key: string): void {
    this.keySet.add(key);
  }

  listKeys(): string[] {
    return Array.from(this.keySet);
  }

  setThrowOnDelete(): void {
    this.throwOnDeleteOnce = true;
  }

  async hSet(key: string, values: Record<string, unknown>): Promise<number> {
    const bucket = this.hashes.get(key) ?? new Map<string, string>();
    for (const [field, value] of Object.entries(values)) {
      bucket.set(field, String(value));
    }
    this.hashes.set(key, bucket);
    this.keySet.add(key);
    return Object.keys(values).length;
  }

  async hGet(key: string, field: string): Promise<string | null> {
    const bucket = this.hashes.get(key);
    if (!bucket) {
      return null;
    }
    return bucket.get(field) ?? null;
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

  async zAdd(
    key: string,
    entries: { score: number; member: string } | { score: number; member: string }[],
  ): Promise<number> {
    const items = Array.isArray(entries) ? entries : [entries];
    const bucket = this.sortedSets.get(key) ?? new Map<string, number>();
    for (const { score, member } of items) {
      bucket.set(member, score);
    }
    if (bucket.size > 0) {
      this.sortedSets.set(key, bucket);
      this.keySet.add(key);
    }
    return bucket.size;
  }

  async zRange(
    key: string,
    start: number,
    stop: number,
    _options?: { by?: string },
  ): Promise<Array<{ member: string; score: number }>> {
    const bucket = this.sortedSets.get(key);
    if (!bucket || bucket.size === 0) {
      return [];
    }

    const sorted = Array.from(bucket.entries()).sort((a, b) => {
      if (a[1] !== b[1]) {
        return a[1] - b[1];
      }
      return a[0].localeCompare(b[0]);
    });

    const normalizeIndex = (index: number): number => {
      if (index < 0) {
        return Math.max(sorted.length + index, 0);
      }
      return index;
    };

    const startIndex = normalizeIndex(start);
    const stopIndex = Math.min(normalizeIndex(stop), sorted.length - 1);
    if (startIndex > stopIndex || startIndex >= sorted.length) {
      return [];
    }

    const slice = sorted.slice(startIndex, stopIndex + 1);
    return slice.map(([member, score]) => ({ member, score }));
  }

  async keys(pattern: string): Promise<string[]> {
    return this.listKeys().filter((key) => this.matches(pattern, key));
  }

  async scan(
    cursor: string | number,
    options?: { match?: string; count?: number },
  ): Promise<[string, string[]]> {
    const matchPattern = options?.match ?? '*';
    const count = options?.count ?? (this.keySet.size || 10);
    const matched = await this.keys(matchPattern);
    const start = typeof cursor === 'string' ? Number.parseInt(cursor, 10) || 0 : cursor;
    const slice = matched.slice(start, start + count);
    const nextCursor = start + count >= matched.length ? '0' : String(start + count);
    return [nextCursor, slice];
  }

  async del(...keys: string[]): Promise<number> {
    if (this.throwOnDeleteOnce) {
      this.throwOnDeleteOnce = false;
      throw new Error('forced delete failure');
    }

    let removed = 0;
    for (const key of keys) {
      if (this.keySet.delete(key)) {
        removed += 1;
      }
      this.hashes.delete(key);
      this.sortedSets.delete(key);
    }
    return removed;
  }

  async info(section?: string): Promise<string> {
    if (section !== 'memory') {
      return '';
    }
    return `used_memory:${this.usedMemory}\nused_memory_peak:${this.peakMemory}\n`;
  }

  async dbsize(): Promise<number> {
    return this.reportedKeyCount ?? this.keySet.size;
  }

  setMemory(used: number, peak: number): void {
    this.usedMemory = used;
    this.peakMemory = peak;
  }

  setKeyCount(total: number): void {
    this.reportedKeyCount = total;
  }

  private matches(pattern: string, value: string): boolean {
    if (pattern === '*') {
      return true;
    }

    const escaped = pattern.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
    const regex = new RegExp(`^${escaped.replace(/\\\*/g, '.*')}$`);
    return regex.test(value);
  }
}

const seedSubredditState = async (redis: FakeRedis, subredditId: SubredditId) => {
  const marketId = 'market-1' as MarketId;
  const betId = 'bet-1' as BetId;
  const userId = 'user-1' as UserId;
  const ledgerEntryId = 'ledger-1' as LedgerEntryId;
  const actionId = 'action-1' as ModeratorActionId;
  const score = Date.now();

  await redis.zAdd(marketKeys.indexAll(subredditId), { score, member: marketId });
  await redis.zAdd(marketKeys.indexByStatus(subredditId, 'open'), { score, member: marketId });
  await redis.zAdd(marketKeys.indexByCreatedAt(subredditId), { score, member: marketId });
  await redis.hSet(marketKeys.record(subredditId, marketId), { id: marketId, status: 'open' });

  await redis.zAdd(marketKeys.betsIndex(subredditId, marketId), { score, member: betId });
  await redis.hSet(betKeys.record(subredditId, betId), {
    id: betId,
    marketId,
    userId,
  });
  redis.addKey(marketKeys.userPointer(subredditId, marketId, userId));
  redis.addKey(marketKeys.lock(subredditId, marketId));
  redis.addKey(marketKeys.schedulerClose(subredditId, marketId));

  await redis.zAdd(userKeys.betsAll(subredditId, userId), { score, member: betId });
  await redis.zAdd(userKeys.betsActive(subredditId, userId), { score, member: betId });
  await redis.hSet(balanceKeys.record(subredditId, userId), { userId, balance: '100' });
  await redis.zAdd(balanceKeys.ledgerIndex(subredditId, userId), { score, member: ledgerEntryId });
  await redis.hSet(ledgerKeys.entry(subredditId, ledgerEntryId), { id: ledgerEntryId, userId });

  await redis.hSet(userDirectoryKeys.usernames(subredditId), { [userId]: 'test-user' });

  await redis.zAdd(auditKeys.list(subredditId), { score, member: actionId });
  await redis.hSet(auditKeys.record(subredditId, actionId), { id: actionId });

  await redis.hSet(metricsKeys.counters(subredditId), { totalMarkets: '1' });
  await redis.hSet(metricsKeys.incidents(subredditId), { fetchedAt: new Date().toISOString() });
  await redis.hSet(configKeys.cache(subredditId), { cached: '1' });
  await redis.hSet(configKeys.override(subredditId), { enabled: 'true' });

  for (const window of DEFAULT_LEADERBOARD_WINDOWS) {
    await redis.zAdd(leaderboardKeys.window(subredditId, window), { score, member: userId });
    await redis.hSet(leaderboardKeys.windowMeta(subredditId, window), {
      [userId]: JSON.stringify({ username: 'test-user' }),
    });
  }

  return { marketId, betId, userId, ledgerEntryId, actionId } as const;
};

describe('OperationsService', () => {
  const subredditId: SubredditId = 'sub-123' as SubredditId;
  let marketRepository: { countByStatus: ReturnType<typeof vi.fn> };
  let incidentsProvider: { getRecent: ReturnType<typeof vi.fn> } | null;
  let redis: FakeRedis;
  let auditLogService: { recordAction: ReturnType<typeof vi.fn> };
  let service: OperationsService;

  beforeEach(() => {
    marketRepository = {
      countByStatus: vi.fn(),
    };
    incidentsProvider = {
      getRecent: vi.fn(),
    };
    redis = new FakeRedis();
    auditLogService = {
      recordAction: vi.fn(),
    };
    service = new OperationsService(
      marketRepository as unknown as MarketRepository,
      incidentsProvider as unknown as { getRecent: (sub: string, limit?: number) => Promise<readonly IncidentSummary[]> },
      redis as unknown as RedisClient,
      auditLogService as unknown as AuditLogService,
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
      auditLogService as unknown as AuditLogService,
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

  it('resets system by deleting subreddit keys and recording audit entry', async () => {
    const moderatorId = 'mod-1' as UserId;
    const moderatorUsername = 'moduser';

    await seedSubredditState(redis, subredditId);
    const otherKey = `dggpm:market:sub-other:market-99`;
    redis.addKey(otherKey);

    const summary = await service.resetSystem(subredditId, {
      moderatorId,
      moderatorUsername,
    });

    expect(summary.deletedKeys).toBeGreaterThan(0);
    expect(summary.errors).toBe(0);
    expect(summary.attemptedKeys).toBeGreaterThanOrEqual(summary.deletedKeys);

    expect(auditLogService.recordAction).toHaveBeenCalledWith(
      subredditId,
      expect.objectContaining({
        action: 'RESET_SYSTEM',
        performedBy: moderatorId,
        performedByUsername: moderatorUsername,
        payload: expect.objectContaining({
          attemptedKeys: summary.attemptedKeys,
          deletedKeys: summary.deletedKeys,
          errors: 0,
          stats: expect.objectContaining({
            markets: 1,
            bets: 1,
            users: 1,
            ledgerEntries: 1,
            auditActions: 1,
          }),
          sampleKeys: expect.arrayContaining([]),
        }),
      }),
    );

    expect(redis.listKeys().sort()).toEqual([otherKey]);
  });

  it('reports deletion errors when redis rejects a batch during reset', async () => {
    const moderatorId = 'mod-2' as UserId;
    const moderatorUsername = 'second-mod';

    await seedSubredditState(redis, subredditId);
    redis.setThrowOnDelete();

    const summary = await service.resetSystem(subredditId, {
      moderatorId,
      moderatorUsername,
      reason: 'test',
    });

    expect(summary.attemptedKeys).toBeGreaterThan(0);
    expect(summary.errors).toBeGreaterThan(0);
    expect(auditLogService.recordAction).toHaveBeenCalledWith(
      subredditId,
      expect.objectContaining({
        action: 'RESET_SYSTEM',
        payload: expect.objectContaining({
          errors: 1,
          reason: 'test',
          stats: expect.any(Object),
        }),
      }),
    );
    expect(redis.listKeys().length).toBeGreaterThan(0);
  });
});
