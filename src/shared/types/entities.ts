export type Brand<T, B extends string> = T & { readonly __brand: B };

export type MarketId = Brand<string, 'MarketId'>;
export type BetId = Brand<string, 'BetId'>;
export type LedgerEntryId = Brand<string, 'LedgerEntryId'>;
export type ModeratorActionId = Brand<string, 'ModeratorActionId'>;
export type UserId = Brand<string, 'UserId'>;
export type SubredditId = Brand<string, 'SubredditId'>;

export type ISODateString = string;
export type Points = number; // Stored as integer >= 0 representing subreddit points

export type BetSide = 'yes' | 'no';
export type MarketStatus = 'draft' | 'open' | 'closed' | 'resolved' | 'void';
export type BetStatus = 'active' | 'won' | 'lost' | 'refunded';
export type LedgerEntryType = 'debit' | 'credit' | 'payout' | 'refund' | 'adjustment';

export interface Market {
  readonly schemaVersion: 1;
  readonly id: MarketId;
  readonly subredditId: SubredditId;
  readonly title: string;
  readonly description: string;
  readonly createdBy: UserId;
  readonly createdAt: ISODateString;
  readonly closesAt: ISODateString;
  readonly resolvedAt: ISODateString | null;
  readonly status: MarketStatus;
  readonly resolution: BetSide | 'void' | null;
  readonly potYes: Points;
  readonly potNo: Points;
  readonly totalBets: number;
  readonly imageUrl: string | null;
  readonly metadata?: Record<string, unknown>;
}

export interface Bet {
  readonly schemaVersion: 1;
  readonly id: BetId;
  readonly marketId: MarketId;
  readonly userId: UserId;
  readonly side: BetSide;
  readonly wager: Points;
  readonly createdAt: ISODateString;
  readonly status: BetStatus;
  readonly payout: Points | null;
  readonly settledAt: ISODateString | null;
}

export interface UserBalance {
  readonly schemaVersion: 1;
  readonly userId: UserId;
  readonly subredditId: SubredditId;
  readonly balance: Points;
  readonly lifetimeEarned: Points;
  readonly lifetimeLost: Points;
  readonly weeklyEarned: Points;
  readonly monthlyEarned: Points;
  readonly updatedAt: ISODateString;
}

export interface LedgerEntry {
  readonly schemaVersion: 1;
  readonly id: LedgerEntryId;
  readonly userId: UserId;
  readonly subredditId: SubredditId;
  readonly marketId: MarketId | null;
  readonly betId: BetId | null;
  readonly type: LedgerEntryType;
  readonly delta: Points;
  readonly balanceAfter: Points;
  readonly createdAt: ISODateString;
  readonly metadata?: Record<string, unknown>;
}

export interface LeaderboardEntry {
  readonly userId: UserId;
  readonly username: string;
  readonly rank: number;
  readonly score: Points;
  readonly delta?: Points;
}
