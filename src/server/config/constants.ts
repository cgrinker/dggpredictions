export const REDIS_NAMESPACE = 'dggpm';
export const MAX_TRANSACTION_RETRIES = 3;
export const DEFAULT_LEADERBOARD_WINDOWS = ['weekly', 'monthly', 'alltime'] as const;

export type LeaderboardWindow = (typeof DEFAULT_LEADERBOARD_WINDOWS)[number];
