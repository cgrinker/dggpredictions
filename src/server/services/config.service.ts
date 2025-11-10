import { settings } from '@devvit/web/server';
import type { AppConfig } from '../../shared/types/config.js';
import type { SubredditId } from '../../shared/types/entities.js';
import { nowIso } from '../utils/time.js';
import { ConfigRepository } from '../repositories/config.repository.js';
import { DEFAULT_APP_CONFIG } from '../config/defaults.js';
import { logger } from '../logging.js';

export class ConfigService {
  private readonly repository: ConfigRepository;

  constructor(repository = new ConfigRepository()) {
    this.repository = repository;
  }

  async getConfig(subredditId: SubredditId): Promise<AppConfig> {
    const cached = await this.repository.getCached(subredditId);
    if (cached) {
      return cached.config;
    }

    const resolved = await this.loadFromSettings();
    await this.repository.cacheConfig({ subredditId, fetchedAt: nowIso(), config: resolved });
    return resolved;
  }

  async refreshConfig(subredditId: SubredditId): Promise<AppConfig> {
    const resolved = await this.loadFromSettings();
    await this.repository.cacheConfig({ subredditId, fetchedAt: nowIso(), config: resolved });
    return resolved;
  }

  private async loadFromSettings(): Promise<AppConfig> {
    try {
      const values = await settings.getAll<Record<string, unknown>>();
      return this.repository.validateConfig(this.mergeWithDefaults(values));
    } catch (error) {
      logger.warn('Failed to load settings; falling back to defaults', { error });
      return DEFAULT_APP_CONFIG;
    }
  }

  private mergeWithDefaults(raw: Record<string, unknown>): AppConfig {
    const featureFlagsRaw = this.extractFeatureFlags(raw);

    return {
      startingBalance: this.asNumber(raw.startingBalance, DEFAULT_APP_CONFIG.startingBalance),
      minBet: this.asNumber(raw.minBet, DEFAULT_APP_CONFIG.minBet),
      maxBet: this.asNullableNumber(raw.maxBet, DEFAULT_APP_CONFIG.maxBet),
      maxOpenMarkets: this.asNullableNumber(raw.maxOpenMarkets, DEFAULT_APP_CONFIG.maxOpenMarkets),
      leaderboardWindow: this.asLeaderboardWindow(
        raw.leaderboardWindow,
        DEFAULT_APP_CONFIG.leaderboardWindow,
      ),
      autoCloseGraceMinutes: this.asNumber(
        raw.autoCloseGraceMinutes,
        DEFAULT_APP_CONFIG.autoCloseGraceMinutes,
      ),
      featureFlags: featureFlagsRaw,
    } satisfies AppConfig;
  }

  private extractFeatureFlags(raw: Record<string, unknown>): AppConfig['featureFlags'] {
    const flags = typeof raw.featureFlags === 'object' && raw.featureFlags !== null ? raw.featureFlags : {};
    const maintenance = this.asBoolean((flags as Record<string, unknown>).maintenanceMode ?? raw.maintenanceMode, DEFAULT_APP_CONFIG.featureFlags.maintenanceMode);
    const realtime = this.asBoolean(
      (flags as Record<string, unknown>).enableRealtimeUpdates ?? raw.enableRealtimeUpdates,
      DEFAULT_APP_CONFIG.featureFlags.enableRealtimeUpdates,
    );
    const leaderboard = this.asBoolean(
      (flags as Record<string, unknown>).enableLeaderboard ?? raw.enableLeaderboard,
      DEFAULT_APP_CONFIG.featureFlags.enableLeaderboard,
    );

    return {
      maintenanceMode: maintenance,
      enableRealtimeUpdates: realtime,
      enableLeaderboard: leaderboard,
    };
  }

  private asNumber(value: unknown, fallback: number): number {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return Math.trunc(value);
    }

    if (typeof value === 'string') {
      const parsed = Number.parseInt(value, 10);
      if (!Number.isNaN(parsed)) {
        return parsed;
      }
    }

    return fallback;
  }

  private asNullableNumber(value: unknown, fallback: number | null): number | null {
    if (value === null || value === undefined || value === '') {
      return null;
    }

    if (typeof value === 'number' && Number.isFinite(value)) {
      return Math.trunc(value);
    }

    if (typeof value === 'string') {
      const parsed = Number.parseInt(value, 10);
      if (!Number.isNaN(parsed)) {
        return parsed;
      }
    }

    return fallback;
  }

  private asLeaderboardWindow(value: unknown, fallback: AppConfig['leaderboardWindow']): AppConfig['leaderboardWindow'] {
    const validValues: AppConfig['leaderboardWindow'][] = ['weekly', 'monthly', 'alltime'];
    if (typeof value === 'string' && validValues.includes(value as AppConfig['leaderboardWindow'])) {
      return value as AppConfig['leaderboardWindow'];
    }
    return fallback;
  }

  private asBoolean(value: unknown, fallback: boolean): boolean {
    if (typeof value === 'boolean') {
      return value;
    }
    if (typeof value === 'string') {
      const lowered = value.toLowerCase();
      if (lowered === 'true') {
        return true;
      }
      if (lowered === 'false') {
        return false;
      }
    }
    return fallback;
  }
}
