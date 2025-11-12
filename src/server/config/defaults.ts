import type { AppConfig } from '../../shared/types/config.js';

export const DEFAULT_APP_CONFIG: AppConfig = {
  startingBalance: 10_000,
  minBet: 100,
  maxBet: null,
  maxOpenMarkets: null,
  leaderboardWindow: 'weekly',
  autoCloseGraceMinutes: 5,
  featureFlags: {
    maintenanceMode: false,
    enableRealtimeUpdates: false,
    enableLeaderboard: true,
    enableConfigEditor: false,
  },
};
