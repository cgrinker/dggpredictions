import type { TxClientLike } from '@devvit/redis';
import type {
  LedgerEntry,
  LedgerEntryType,
  MarketId,
  Points,
  SubredditId,
  UserId,
  BetId,
} from '../../shared/types/entities.js';
import { LedgerRepository } from '../repositories/ledger.repository.js';
import { LeaderboardRepository } from '../repositories/leaderboard.repository.js';
import { DEFAULT_LEADERBOARD_WINDOWS } from '../config/constants.js';
import { createLedgerEntryId } from '../utils/id.js';
import { nowIso } from '../utils/time.js';
import { UserDirectoryService } from './user-directory.service.js';

interface LedgerEntryOptions {
  readonly subredditId: SubredditId;
  readonly userId: UserId;
  readonly marketId?: MarketId | null;
  readonly betId?: BetId | null;
  readonly type: LedgerEntryType;
  readonly delta: Points;
  readonly balanceAfter: Points;
  readonly metadata?: Record<string, unknown>;
}

export class LedgerService {
  private readonly repository: LedgerRepository;
  private readonly leaderboards: LeaderboardRepository;
  private readonly userDirectory: UserDirectoryService;

  constructor(
    repository = new LedgerRepository(),
    leaderboards = new LeaderboardRepository(),
    userDirectory = new UserDirectoryService(),
  ) {
    this.repository = repository;
    this.leaderboards = leaderboards;
    this.userDirectory = userDirectory;
  }

  async record(tx: TxClientLike, options: LedgerEntryOptions): Promise<LedgerEntry> {
    const base: Omit<LedgerEntry, 'metadata'> & { metadata?: Record<string, unknown> } = {
      schemaVersion: 1,
      id: createLedgerEntryId(),
      subredditId: options.subredditId,
      userId: options.userId,
      marketId: options.marketId ?? null,
      betId: options.betId ?? null,
      type: options.type,
      delta: options.delta,
      balanceAfter: options.balanceAfter,
      createdAt: nowIso(),
    };

    if (options.metadata) {
      base.metadata = options.metadata;
    }

    const entry: LedgerEntry = base;

    await this.repository.create(tx, entry);
    const usernameFromMetadata = this.extractUsername(entry.metadata);
    if (usernameFromMetadata) {
      await this.userDirectory.rememberUser(entry.subredditId, entry.userId, usernameFromMetadata);
    }
    await this.updateLeaderboards(tx, entry);
    return entry;
  }

  private async updateLeaderboards(tx: TxClientLike, entry: LedgerEntry): Promise<void> {
    const amount = this.resolveLeaderboardDelta(entry.type, entry.delta);
    if (amount <= 0) {
      return;
    }

    const usernameFromMetadata = this.extractUsername(entry.metadata);
    const resolvedUsername =
      usernameFromMetadata ?? (await this.userDirectory.resolveUsername(entry.subredditId, entry.userId));

    await Promise.all(
      DEFAULT_LEADERBOARD_WINDOWS.map((window) =>
        this.leaderboards.increment(tx, entry.subredditId, window, entry.userId, amount, {
          delta: amount,
          ...(resolvedUsername ? { username: resolvedUsername } : {}),
        }),
      ),
    );
  }

  private extractUsername(metadata: LedgerEntry['metadata']): string | null {
    if (!metadata) {
      return null;
    }

    const raw = metadata.username;
    if (typeof raw !== 'string') {
      return null;
    }

    const normalized = raw.trim();
    return normalized.length > 0 ? normalized : null;
  }

  private resolveLeaderboardDelta(type: LedgerEntryType, delta: Points): Points {
    switch (type) {
      case 'credit':
      case 'payout':
      case 'refund':
      case 'adjustment':
        return delta;
      default:
        return 0 as Points;
    }
  }
}
