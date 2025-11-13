import { reddit } from '@devvit/web/server';
import type { LeaderboardEntry } from '../../shared/types/entities.js';
import type { LeaderboardResponse, SetLeaderboardFlairResponse } from '../../shared/types/dto.js';
import type { LeaderboardWindow } from '../config/constants.js';
import type { SubredditId, UserId } from '../../shared/types/entities.js';
import { DEFAULT_LEADERBOARD_WINDOWS } from '../config/constants.js';
import { LeaderboardRepository } from '../repositories/leaderboard.repository.js';
import { ConfigService } from './config.service.js';
import { ValidationError } from '../errors.js';
import { nowIso } from '../utils/time.js';
import { UserDirectoryService } from './user-directory.service.js';
import { logger } from '../logging.js';

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

  async setUserRankFlair(
    subredditId: SubredditId,
    subredditName: string,
    user: { readonly id: UserId | null; readonly username: string | null },
    options?: LeaderboardOptions,
  ): Promise<SetLeaderboardFlairResponse> {
    if (!user.id) {
      throw new ValidationError('You must be signed in to update your flair.');
    }

    if (!user.username) {
      throw new ValidationError('A valid username is required to update flair.');
    }

    const config = await this.config.getConfig(subredditId);
    if (!config.featureFlags.enableLeaderboard) {
      throw new ValidationError('Leaderboard feature is disabled for this subreddit.');
    }

    const window = this.resolveWindow(options?.window ?? config.leaderboardWindow);
    const entry = await this.leaderboards.getUser(subredditId, window, user.id);
    if (!entry) {
      throw new ValidationError('You need a leaderboard rank before updating flair.');
    }

    const overrides = this.buildOverrideMap(user.id, user.username);
    const [enriched] = await this.enrichEntries(subredditId, [entry], overrides);
    if (!enriched) {
      throw new ValidationError('Unable to resolve your leaderboard entry.');
    }
    const flairText = `DGG Predict Rank: ${enriched.rank}`;

    try {
      await reddit.setUserFlair({
        subredditName,
        username: user.username,
        text: flairText,
      });
    } catch (error) {
      logger.error('failed to set user flair', {
        subredditId,
        subredditName,
        userId: user.id,
        username: user.username,
        window,
        message: error instanceof Error ? error.message : 'unknown error',
      });

      throw new ValidationError('Unable to update flair right now. Please try again later.', {
        cause: error,
      });
    }

    return {
      flairText,
      window,
      rank: enriched.rank,
    } satisfies SetLeaderboardFlairResponse;
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
