import type {
  BetId,
  LedgerEntryId,
  MarketId,
  ModeratorActionId,
  SubredditId,
  UserId,
} from '../../shared/types/entities.js';
import { REDIS_NAMESPACE } from '../config/constants.js';

const concat = (...parts: (string | number | undefined)[]): string =>
  parts.filter((part) => part !== undefined).join(':');

const base = (entity: string, subredditId: SubredditId | string, ...rest: (string | number)[]) =>
  concat(REDIS_NAMESPACE, entity, subredditId, ...rest);

export const marketKeys = {
  indexAll: (subredditId: SubredditId) => base('markets', subredditId),
  indexByStatus: (subredditId: SubredditId, status: string) => base('markets', subredditId, `status-${status}`),
  indexByCreatedAt: (subredditId: SubredditId) => base('markets', subredditId, 'createdAt'),
  record: (subredditId: SubredditId, marketId: MarketId) => base('market', subredditId, marketId),
  betsIndex: (subredditId: SubredditId, marketId: MarketId) => base('market', subredditId, marketId, 'bets'),
  userPointer: (subredditId: SubredditId, marketId: MarketId, userId: UserId) =>
    base('market', subredditId, marketId, 'user', userId),
  lock: (subredditId: SubredditId, marketId: MarketId) => base('lock', subredditId, `market-${marketId}`),
  schedulerClose: (subredditId: SubredditId, marketId: MarketId) => base('scheduler', subredditId, marketId, 'close'),
};

export const betKeys = {
  record: (subredditId: SubredditId, betId: BetId) => base('bet', subredditId, betId),
};

export const balanceKeys = {
  record: (subredditId: SubredditId, userId: UserId) => base('balance', subredditId, userId),
  ledgerIndex: (subredditId: SubredditId, userId: UserId) => base('ledger', subredditId, userId),
};

export const ledgerKeys = {
  entry: (subredditId: SubredditId, entryId: LedgerEntryId) => base('ledger-entry', subredditId, entryId),
};

export const userKeys = {
  betsAll: (subredditId: SubredditId, userId: UserId) => base('user', subredditId, userId, 'bets', 'all'),
  betsActive: (subredditId: SubredditId, userId: UserId) => base('user', subredditId, userId, 'bets', 'active'),
};

export const leaderboardKeys = {
  window: (subredditId: SubredditId, window: string) => base('leaderboard', subredditId, window),
  windowMeta: (subredditId: SubredditId, window: string) =>
    base('leaderboard', subredditId, window, 'meta'),
};

export const configKeys = {
  cache: (subredditId: SubredditId) => base('config', subredditId, 'cache'),
  override: (subredditId: SubredditId) => base('config', subredditId, 'override'),
};

export const userDirectoryKeys = {
  usernames: (subredditId: SubredditId) => base('user-directory', subredditId, 'usernames'),
};

export const auditKeys = {
  list: (subredditId: SubredditId) => base('audit', subredditId, 'actions'),
  record: (subredditId: SubredditId, actionId: ModeratorActionId) => base('mod-action', subredditId, actionId),
};

export const metricsKeys = {
  storage: () => concat(REDIS_NAMESPACE, 'metrics', 'storage'),
  counters: (subredditId: SubredditId) => base('metrics', subredditId, 'counters'),
  incidents: (subredditId: SubredditId) => base('metrics', subredditId, 'incidents'),
};
