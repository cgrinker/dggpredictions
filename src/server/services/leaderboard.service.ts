import type { LeaderboardEntry } from '../../shared/types/entities.js';
import type { LeaderboardResponse } from '../../shared/types/dto.js';
import type { LeaderboardWindow } from '../config/constants.js';
import type { SubredditId, UserId } from '../../shared/types/entities.js';
import { DEFAULT_LEADERBOARD_WINDOWS } from '../config/constants.js';
import { LeaderboardRepository } from '../repositories/leaderboard.repository.js';
import { ConfigService } from './config.service.js';
import { ValidationError } from '../errors.js';
import { nowIso } from '../utils/time.js';
import { UserDirectoryService } from './user-directory.service.js';

const MAX_ENTRIES = 100;

export interface LeaderboardOptions {
  readonly window?: LeaderboardWindow;
  readonly limit?: number;
}

export class LeaderboardService {
  private readonly leaderboards: LeaderboardRepository;
  private readonly config: ConfigService;
  private readonly userDirectory: UserDirectoryService;

  constructor(
    leaderboards = new LeaderboardRepository(),
    config = new ConfigService(),
    userDirectory = new UserDirectoryService(),
  ) {
    this.leaderboards = leaderboards;
    this.config = config;
    this.userDirectory = userDirectory;
  }

  async getLeaderboard(
    subredditId: SubredditId,
    user: { readonly id: UserId | null; readonly username: string | null },
    options?: LeaderboardOptions,
  ): Promise<LeaderboardResponse> {
    const config = await this.config.getConfig(subredditId);
    if (!config.featureFlags.enableLeaderboard) {
      throw new ValidationError('Leaderboard feature is disabled for this subreddit.');
    }

    const window = this.resolveWindow(options?.window ?? config.leaderboardWindow);
    const limit = this.resolveLimit(options?.limit);

    const entries = await this.leaderboards.list(subredditId, window, { limit });
    const currentUser = user.id
      ? await this.leaderboards.getUser(subredditId, window, user.id)
      : null;

    const overrides = this.buildOverrideMap(currentUser?.userId, user.username);
    const enrichedEntries = await this.enrichEntries(subredditId, entries, overrides);
    const enrichedCurrentUser = currentUser
      ? (await this.enrichEntries(subredditId, [currentUser], overrides))[0]
      : null;

    const response: LeaderboardResponse = {
      window,
      asOf: nowIso(),
      entries: enrichedEntries,
      ...(enrichedCurrentUser ? { currentUser: enrichedCurrentUser } : {}),
    };

    return response;
  }

  private buildOverrideMap(
    userId: UserId | undefined,
    username: string | null,
  ): Map<UserId, string> {
    if (!userId || !username) {
      return new Map();
    }

    const normalized = username.trim();
    if (!normalized) {
      return new Map();
    }

    return new Map([[userId, normalized]]);
  }

  private async enrichEntries(
    subredditId: SubredditId,
    entries: readonly LeaderboardEntry[],
    overrides: Map<UserId, string>,
  ): Promise<LeaderboardEntry[]> {
    const fallbackEntries = entries.filter((entry) => this.isFallbackUsername(entry.username));
    const fallbackIds = fallbackEntries.map((entry) => entry.userId);
    const resolved = await this.userDirectory.resolveUsernames(subredditId, fallbackIds);

    return entries.map((entry) => {
      const override = overrides.get(entry.userId);
      if (override) {
        return { ...entry, username: override };
      }

      if (!this.isFallbackUsername(entry.username)) {
        return entry;
      }

      const stored = resolved.get(entry.userId);
      if (stored) {
        return { ...entry, username: stored };
      }

      return entry;
    });
  }

  private isFallbackUsername(username: string): boolean {
    return username.startsWith('user:');
  }

  private resolveWindow(candidate: LeaderboardWindow): LeaderboardWindow {
    if (DEFAULT_LEADERBOARD_WINDOWS.includes(candidate)) {
      return candidate;
    }
    throw new ValidationError('Unsupported leaderboard window requested.');
  }

  private resolveLimit(candidate: number | undefined): number {
    if (candidate === undefined) {
      return 25;
    }

    if (!Number.isFinite(candidate) || candidate <= 0) {
      throw new ValidationError('Limit must be a positive number.');
    }

    return Math.min(Math.trunc(candidate), MAX_ENTRIES);
  }
}
