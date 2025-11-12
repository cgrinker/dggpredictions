export interface FeatureFlags {
  readonly maintenanceMode: boolean;
  readonly enableRealtimeUpdates: boolean;
  readonly enableLeaderboard: boolean;
  readonly enableConfigEditor: boolean;
}

export interface AppConfig {
  readonly startingBalance: number;
  readonly minBet: number;
  readonly maxBet: number | null;
  readonly maxOpenMarkets: number | null;
  readonly leaderboardWindow: 'weekly' | 'monthly' | 'alltime';
  readonly autoCloseGraceMinutes: number;
  readonly featureFlags: FeatureFlags;
}

export interface ConfigSnapshot {
  readonly subredditId: string;
  readonly fetchedAt: string;
  readonly config: AppConfig;
}
