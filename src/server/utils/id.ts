import { randomUUID } from 'node:crypto';
import type {
  BetId,
  LedgerEntryId,
  MarketId,
  ModeratorActionId,
} from '../../shared/types/entities.js';

export const createMarketId = (): MarketId => randomUUID() as MarketId;
export const createBetId = (): BetId => randomUUID() as BetId;
export const createLedgerEntryId = (): LedgerEntryId => randomUUID() as LedgerEntryId;
export const createModeratorActionId = (): ModeratorActionId => randomUUID() as ModeratorActionId;
