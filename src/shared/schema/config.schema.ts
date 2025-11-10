import { z } from 'zod';
import { ISODateStringSchema } from './entities.schema.js';

export const FeatureFlagsSchema = z
  .object({
    maintenanceMode: z.boolean().default(false),
    enableRealtimeUpdates: z.boolean().default(false),
    enableLeaderboard: z.boolean().default(true),
  })
  .strict();

export const AppConfigSchema = z
  .object({
    startingBalance: z.number().int().min(0),
    minBet: z.number().int().min(1),
    maxBet: z.number().int().min(1).nullable(),
    maxOpenMarkets: z.number().int().min(1).nullable(),
    leaderboardWindow: z.enum(['weekly', 'monthly', 'alltime']).default('weekly'),
    autoCloseGraceMinutes: z.number().int().min(0).max(10_080).default(5),
    featureFlags: FeatureFlagsSchema,
  })
  .strict();

export const ConfigSnapshotSchema = z
  .object({
    subredditId: z.string().min(1),
    fetchedAt: ISODateStringSchema,
    config: AppConfigSchema,
  })
  .strict();
