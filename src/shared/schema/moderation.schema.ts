import { z } from 'zod';
import {
  ISODateStringSchema,
  MarketIdSchema,
  ModeratorActionIdSchema,
  SubredditIdSchema,
  UserIdSchema,
} from './entities.schema.js';

export const ModeratorActionTypeSchema = z.enum([
  'CREATE_MARKET',
  'PUBLISH_MARKET',
  'UPDATE_MARKET',
  'CLOSE_MARKET',
  'RESOLVE_MARKET',
  'VOID_MARKET',
  'ADJUST_BALANCE',
  'ARCHIVE_MARKETS',
]);

export const ModeratorActionSchema = z
  .object({
    schemaVersion: z.literal(1),
  id: ModeratorActionIdSchema,
    subredditId: SubredditIdSchema,
    performedBy: UserIdSchema,
    performedByUsername: z.string().min(1),
    action: ModeratorActionTypeSchema,
    marketId: MarketIdSchema.nullable(),
    targetUserId: UserIdSchema.nullable(),
    payload: z.record(z.string(), z.unknown()),
    snapshot: z
      .object({
        before: z.unknown().nullable(),
        after: z.unknown().nullable(),
      })
      .strict()
      .optional(),
    createdAt: ISODateStringSchema,
    correlationId: z.string().min(1).optional(),
  })
  .strict();
