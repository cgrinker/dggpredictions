import { z } from 'zod';
import type {
  Bet,
  BetId,
  BetSide,
  BetStatus,
  ISODateString,
  LeaderboardEntry,
  LedgerEntry,
  LedgerEntryId,
  LedgerEntryType,
  ModeratorActionId,
  Market,
  MarketId,
  MarketStatus,
  Points,
  SubredditId,
  UserBalance,
  UserId,
} from '../types/entities.js';

const brand = <T extends string>() =>
  z.string().min(1).transform((value) => value as unknown as string & { readonly __brand: T });

export const ISODateStringSchema = z
  .string()
  .datetime({ offset: true })
  .transform((value) => value as ISODateString);

export const PointsSchema = z.number().int().min(0).transform((value) => value as Points);

export const UserIdSchema = brand<'UserId'>().transform((value) => value as UserId);
export const SubredditIdSchema = brand<'SubredditId'>().transform((value) => value as SubredditId);
export const MarketIdSchema = brand<'MarketId'>().transform((value) => value as MarketId);
export const BetIdSchema = brand<'BetId'>().transform((value) => value as BetId);
export const LedgerEntryIdSchema = brand<'LedgerEntryId'>().transform((value) => value as LedgerEntryId);
export const ModeratorActionIdSchema = brand<'ModeratorActionId'>().transform(
  (value) => value as ModeratorActionId,
);

export const BetSideSchema = z.enum(['yes', 'no']).transform((value) => value as BetSide);
export const MarketStatusSchema = z
  .enum(['draft', 'open', 'closed', 'resolved', 'void'])
  .transform((value) => value as MarketStatus);
export const BetStatusSchema = z
  .enum(['active', 'won', 'lost', 'refunded'])
  .transform((value) => value as BetStatus);
export const LedgerEntryTypeSchema = z
  .enum(['debit', 'credit', 'payout', 'refund', 'adjustment'])
  .transform((value) => value as LedgerEntryType);

const MarketSchemaCore = z
  .object({
    schemaVersion: z.literal(1),
    id: MarketIdSchema,
    subredditId: SubredditIdSchema,
    title: z.string().min(1).max(140),
    description: z.string().min(1).max(4000),
    createdBy: UserIdSchema,
    createdAt: ISODateStringSchema,
    closesAt: ISODateStringSchema,
    resolvedAt: ISODateStringSchema.nullable(),
    status: MarketStatusSchema,
    resolution: z.union([BetSideSchema, z.literal('void')]).nullable(),
    potYes: PointsSchema,
    potNo: PointsSchema,
    totalBets: z.number().int().min(0),
    imageUrl: z
      .string()
      .url()
      .max(2_048)
      .nullable(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export const MarketSchema = MarketSchemaCore.transform((value) => value as Market);
export const MarketSchemaBase = MarketSchemaCore;

const BetSchemaCore = z
  .object({
    schemaVersion: z.literal(1),
    id: BetIdSchema,
    marketId: MarketIdSchema,
    userId: UserIdSchema,
    side: BetSideSchema,
    wager: PointsSchema,
    createdAt: ISODateStringSchema,
    status: BetStatusSchema,
    payout: PointsSchema.nullable(),
    settledAt: ISODateStringSchema.nullable(),
  })
  .strict();

export const BetSchema = BetSchemaCore.transform((value) => value as Bet);
export const BetSchemaBase = BetSchemaCore;

const UserBalanceSchemaCore = z
  .object({
    schemaVersion: z.literal(1),
    userId: UserIdSchema,
    subredditId: SubredditIdSchema,
    balance: PointsSchema,
    lifetimeEarned: PointsSchema,
    lifetimeLost: PointsSchema,
    weeklyEarned: PointsSchema,
    monthlyEarned: PointsSchema,
    updatedAt: ISODateStringSchema,
  })
  .strict();

export const UserBalanceSchema = UserBalanceSchemaCore.transform((value) => value as UserBalance);
export const UserBalanceSchemaBase = UserBalanceSchemaCore;

const LedgerEntrySchemaCore = z
  .object({
    schemaVersion: z.literal(1),
    id: LedgerEntryIdSchema,
    userId: UserIdSchema,
    subredditId: SubredditIdSchema,
    marketId: MarketIdSchema.nullable(),
    betId: BetIdSchema.nullable(),
    type: LedgerEntryTypeSchema,
    delta: PointsSchema,
    balanceAfter: PointsSchema,
    createdAt: ISODateStringSchema,
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export const LedgerEntrySchema = LedgerEntrySchemaCore.transform((value) => value as LedgerEntry);
export const LedgerEntrySchemaBase = LedgerEntrySchemaCore;

const LeaderboardEntrySchemaCore = z
  .object({
    userId: UserIdSchema,
    username: z.string().min(1),
    rank: z.number().int().min(1),
    score: PointsSchema,
    delta: PointsSchema.optional(),
  })
  .strict();

export const LeaderboardEntrySchema = LeaderboardEntrySchemaCore.transform(
  (value) => value as LeaderboardEntry,
);
export const LeaderboardEntrySchemaBase = LeaderboardEntrySchemaCore;
