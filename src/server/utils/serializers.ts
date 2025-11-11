import {
  BetSchema,
  BetSchemaBase,
  LedgerEntrySchema,
  LedgerEntrySchemaBase,
  MarketSchema,
  MarketSchemaBase,
  UserBalanceSchema,
  UserBalanceSchemaBase,
} from '../../shared/schema/entities.schema.js';
import { ModeratorActionSchema } from '../../shared/schema/moderation.schema.js';
import type {
  Bet,
  LedgerEntry,
  Market,
  Points,
  UserBalance,
} from '../../shared/types/entities.js';
import type { ModeratorActionBase } from '../../shared/types/moderation.js';

type RedisHash = Record<string, string>;

const stringify = (value: unknown): string => JSON.stringify(value);

const parseJson = <T>(value: string | undefined): T | undefined =>
  value === undefined ? undefined : (JSON.parse(value) as T);

const asNumber = (value: string | undefined, fallback = 0): number =>
  value === undefined ? fallback : Number(value);

const assertHash = (hash: RedisHash | null): hash is RedisHash =>
  Boolean(hash && Object.keys(hash).length > 0);

export const serializeMarket = (market: Market): RedisHash => ({
  schemaVersion: market.schemaVersion.toString(),
  id: market.id,
  subredditId: market.subredditId,
  title: market.title,
  description: market.description,
  createdBy: market.createdBy,
  createdAt: market.createdAt,
  closesAt: market.closesAt,
  resolvedAt: market.resolvedAt ?? '',
  status: market.status,
  resolution: market.resolution ?? '',
  potYes: market.potYes.toString(),
  potNo: market.potNo.toString(),
  totalBets: market.totalBets.toString(),
  metadata: market.metadata ? stringify(market.metadata) : '',
});

export const deserializeMarket = (hash: RedisHash | null): Market | null => {
  if (!assertHash(hash)) {
    return null;
  }

  const candidate = MarketSchemaBase.parse({
    schemaVersion: Number(hash.schemaVersion),
    id: hash.id,
    subredditId: hash.subredditId,
    title: hash.title,
    description: hash.description,
    createdBy: hash.createdBy,
    createdAt: hash.createdAt,
    closesAt: hash.closesAt,
    resolvedAt: hash.resolvedAt ? hash.resolvedAt : null,
    status: hash.status,
    resolution: hash.resolution ? (hash.resolution as Market['resolution']) : null,
    potYes: asNumber(hash.potYes) as Points,
    potNo: asNumber(hash.potNo) as Points,
    totalBets: asNumber(hash.totalBets),
    metadata: hash.metadata ? parseJson(hash.metadata) : undefined,
  });

  return MarketSchema.parse(candidate);
};

export const serializeBet = (bet: Bet): RedisHash => ({
  schemaVersion: bet.schemaVersion.toString(),
  id: bet.id,
  marketId: bet.marketId,
  userId: bet.userId,
  side: bet.side,
  wager: bet.wager.toString(),
  createdAt: bet.createdAt,
  status: bet.status,
  payout: bet.payout?.toString() ?? '',
  settledAt: bet.settledAt ?? '',
});

export const deserializeBet = (hash: RedisHash | null): Bet | null => {
  if (!assertHash(hash)) {
    return null;
  }

  const candidate = BetSchemaBase.parse({
    schemaVersion: Number(hash.schemaVersion),
    id: hash.id,
    marketId: hash.marketId,
    userId: hash.userId,
    side: hash.side,
    wager: asNumber(hash.wager) as Points,
    createdAt: hash.createdAt,
    status: hash.status,
    payout: hash.payout ? (asNumber(hash.payout) as Points) : null,
    settledAt: hash.settledAt ? hash.settledAt : null,
  });

  return BetSchema.parse(candidate);
};

export const serializeUserBalance = (balance: UserBalance): RedisHash => ({
  schemaVersion: balance.schemaVersion.toString(),
  userId: balance.userId,
  subredditId: balance.subredditId,
  balance: balance.balance.toString(),
  lifetimeEarned: balance.lifetimeEarned.toString(),
  lifetimeLost: balance.lifetimeLost.toString(),
  weeklyEarned: balance.weeklyEarned.toString(),
  monthlyEarned: balance.monthlyEarned.toString(),
  updatedAt: balance.updatedAt,
});

export const deserializeUserBalance = (hash: RedisHash | null): UserBalance | null => {
  if (!assertHash(hash)) {
    return null;
  }

  const candidate = UserBalanceSchemaBase.parse({
    schemaVersion: Number(hash.schemaVersion),
    userId: hash.userId,
    subredditId: hash.subredditId,
    balance: asNumber(hash.balance) as Points,
    lifetimeEarned: asNumber(hash.lifetimeEarned) as Points,
    lifetimeLost: asNumber(hash.lifetimeLost) as Points,
    weeklyEarned: asNumber(hash.weeklyEarned) as Points,
    monthlyEarned: asNumber(hash.monthlyEarned) as Points,
    updatedAt: hash.updatedAt,
  });

  return UserBalanceSchema.parse(candidate);
};

export const serializeLedgerEntry = (entry: LedgerEntry): RedisHash => ({
  schemaVersion: entry.schemaVersion.toString(),
  id: entry.id,
  userId: entry.userId,
  subredditId: entry.subredditId,
  marketId: entry.marketId ?? '',
  betId: entry.betId ?? '',
  type: entry.type,
  delta: entry.delta.toString(),
  balanceAfter: entry.balanceAfter.toString(),
  createdAt: entry.createdAt,
  metadata: entry.metadata ? stringify(entry.metadata) : '',
});

export const deserializeLedgerEntry = (hash: RedisHash | null): LedgerEntry | null => {
  if (!assertHash(hash)) {
    return null;
  }

  const candidate = LedgerEntrySchemaBase.parse({
    schemaVersion: Number(hash.schemaVersion),
    id: hash.id,
    userId: hash.userId,
    subredditId: hash.subredditId,
    marketId: hash.marketId ? hash.marketId : null,
    betId: hash.betId ? hash.betId : null,
    type: hash.type,
    delta: asNumber(hash.delta) as Points,
    balanceAfter: asNumber(hash.balanceAfter) as Points,
    createdAt: hash.createdAt,
    metadata: hash.metadata ? parseJson(hash.metadata) : undefined,
  });

  return LedgerEntrySchema.parse(candidate);
};

export const serializeModeratorAction = (action: ModeratorActionBase): RedisHash => ({
  schemaVersion: action.schemaVersion.toString(),
  id: action.id,
  subredditId: action.subredditId,
  performedBy: action.performedBy,
  performedByUsername: action.performedByUsername,
  action: action.action,
  marketId: action.marketId ?? '',
  targetUserId: action.targetUserId ?? '',
  payload: stringify(action.payload ?? {}),
  snapshot: action.snapshot ? stringify(action.snapshot) : '',
  createdAt: action.createdAt,
  correlationId: action.correlationId ?? '',
});

export const deserializeModeratorAction = (hash: RedisHash | null): ModeratorActionBase | null => {
  if (!assertHash(hash)) {
    return null;
  }

  const candidate = ModeratorActionSchema.parse({
    schemaVersion: Number(hash.schemaVersion),
    id: hash.id,
    subredditId: hash.subredditId,
    performedBy: hash.performedBy,
    performedByUsername: hash.performedByUsername,
    action: hash.action,
    marketId: hash.marketId ? hash.marketId : null,
    targetUserId: hash.targetUserId ? hash.targetUserId : null,
    payload: hash.payload ? parseJson<Record<string, unknown>>(hash.payload) ?? {} : {},
    snapshot: hash.snapshot ? parseJson(hash.snapshot) : undefined,
    createdAt: hash.createdAt,
    correlationId: hash.correlationId ? hash.correlationId : undefined,
  });

  return candidate as ModeratorActionBase;
};
