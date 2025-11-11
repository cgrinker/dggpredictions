import { z } from 'zod';
import {
  BetSchema,
  BetSchemaBase,
  BetStatusSchema,
  BetSideSchema,
  ISODateStringSchema,
  LeaderboardEntrySchema,
  MarketIdSchema,
  MarketSchemaBase,
  MarketStatusSchema,
  PointsSchema,
  SubredditIdSchema,
  UserIdSchema,
} from './entities.schema.js';

export const PaginationSchema = z
  .object({
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1).max(100),
    total: z.number().int().min(0),
  })
  .strict();

export const PaginatedResponseSchema = <TSchema extends z.ZodTypeAny>(item: TSchema) =>
  z
    .object({
      data: z.array(item).readonly(),
      pagination: PaginationSchema,
    })
    .strict();

export const MarketSummarySchema = z
  .object({
    id: MarketIdSchema,
    title: z.string().min(1),
    status: MarketStatusSchema,
    closesAt: ISODateStringSchema,
    potYes: PointsSchema,
    potNo: PointsSchema,
    totalBets: z.number().int().min(0),
    impliedYesPayout: z.number().positive(),
    impliedNoPayout: z.number().positive(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export const MarketDetailSchema = MarketSchemaBase.extend({
  userBet: BetSchema.nullable(),
});

export const BetSummarySchema = z
  .object({
    id: BetSchemaBase.shape.id,
    marketId: MarketIdSchema,
    side: BetSideSchema,
    wager: PointsSchema,
    status: BetStatusSchema,
    createdAt: ISODateStringSchema,
    payout: PointsSchema.nullable(),
    settledAt: ISODateStringSchema.nullable(),
    marketTitle: z.string().min(1),
    marketStatus: MarketStatusSchema,
  })
  .strict();

export const WalletSnapshotSchema = z
  .object({
    userId: UserIdSchema,
    subredditId: SubredditIdSchema,
    balance: PointsSchema,
    lifetimeEarned: PointsSchema,
    lifetimeLost: PointsSchema,
    weeklyEarned: PointsSchema,
    monthlyEarned: PointsSchema,
    updatedAt: ISODateStringSchema,
    activeBets: z.number().int().min(0),
  })
  .strict();

export const PlaceBetRequestSchema = z
  .object({
    marketId: MarketIdSchema,
    side: BetSideSchema,
    wager: PointsSchema,
  })
  .strict();

export const PlaceBetResponseSchema = z
  .object({
    bet: BetSchema,
    balance: WalletSnapshotSchema,
    market: MarketDetailSchema,
  })
  .strict();

export const CreateMarketRequestSchema = z
  .object({
    title: z.string().min(1).max(140),
    description: z.string().min(1).max(4000),
    closesAt: ISODateStringSchema,
    tags: z.array(z.string().min(1)).max(10).optional(),
  })
  .strict();

export const MarketStateChangeRequestSchema = z
  .object({
    marketId: MarketIdSchema,
  })
  .strict();

export const PublishMarketRequestSchema = MarketStateChangeRequestSchema.extend({
  autoCloseOverrideMinutes: z
    .number()
    .int()
    .min(1)
    .max(10_080)
    .nullable()
    .optional(),
});

const ArchivableStatuses = z.enum(['closed', 'resolved', 'void']);

export const ArchiveMarketsRequestSchema = z
  .object({
    olderThanDays: z.number().int().min(1).max(365),
    statuses: z.array(ArchivableStatuses).min(1).optional(),
    maxMarkets: z.number().int().min(1).max(5_000).optional(),
    dryRun: z.boolean().optional(),
  })
  .strict();

export const ResolveMarketRequestSchema = MarketStateChangeRequestSchema.extend({
  resolution: BetSideSchema,
  notes: z.string().max(2000).optional(),
});

export const VoidMarketRequestSchema = MarketStateChangeRequestSchema.extend({
  reason: z.string().min(1).max(2000),
});

export const AdjustBalanceRequestSchema = z
  .object({
    targetUserId: UserIdSchema,
    subredditId: SubredditIdSchema,
    delta: PointsSchema,
    reasonCode: z.enum(['DISPUTE_REFUND', 'BUG_FIX', 'MOD_REWARD', 'OTHER']),
    memo: z.string().max(2000).optional(),
  })
  .strict();

export const LeaderboardResponseSchema = z
  .object({
    window: z.enum(['weekly', 'monthly', 'alltime']),
    asOf: ISODateStringSchema,
    entries: z.array(LeaderboardEntrySchema).readonly(),
    currentUser: LeaderboardEntrySchema.optional(),
  })
  .strict();

export const ApiSuccessEnvelopeSchema = <TSchema extends z.ZodTypeAny>(payload: TSchema) =>
  z
    .object({
      data: payload,
      meta: z.record(z.string(), z.unknown()).optional(),
    })
    .strict();

export const ApiErrorEnvelopeSchema = z
  .object({
    error: z
      .object({
        code: z.string(),
        message: z.string(),
        details: z.record(z.string(), z.unknown()).optional(),
      })
      .strict(),
  })
  .strict();
