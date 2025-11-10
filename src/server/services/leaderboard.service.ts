import type { LeaderboardResponse } from '../../shared/types/dto.js';
import type { LeaderboardWindow } from '../config/constants.js';
import type { SubredditId, UserId } from '../../shared/types/entities.js';
import { DEFAULT_LEADERBOARD_WINDOWS } from '../config/constants.js';
import { LeaderboardRepository } from '../repositories/leaderboard.repository.js';
import { ConfigService } from './config.service.js';
import { ValidationError } from '../errors.js';
import { nowIso } from '../utils/time.js';

const MAX_ENTRIES = 100;

export interface LeaderboardOptions {
  readonly window?: LeaderboardWindow;
  readonly limit?: number;
}

export class LeaderboardService {
  private readonly leaderboards: LeaderboardRepository;
  private readonly config: ConfigService;

  constructor(
    leaderboards = new LeaderboardRepository(),
    config = new ConfigService(),
  ) {
    this.leaderboards = leaderboards;
    this.config = config;
  }

  async getLeaderboard(
    subredditId: SubredditId,
    userId: UserId | null,
    options?: LeaderboardOptions,
  ): Promise<LeaderboardResponse> {
    const config = await this.config.getConfig(subredditId);
    if (!config.featureFlags.enableLeaderboard) {
      throw new ValidationError('Leaderboard feature is disabled for this subreddit.');
    }

    const window = this.resolveWindow(options?.window ?? config.leaderboardWindow);
    const limit = this.resolveLimit(options?.limit);

    const entries = await this.leaderboards.list(subredditId, window, { limit });
    const currentUser = userId
      ? await this.leaderboards.getUser(subredditId, window, userId)
      : null;

    const response: LeaderboardResponse = {
      window,
      asOf: nowIso(),
      entries,
      ...(currentUser ? { currentUser } : {}),
    };

    return response;
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
