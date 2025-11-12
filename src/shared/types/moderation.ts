import type { ISODateString, MarketId, ModeratorActionId, SubredditId, UserId } from './entities.js';

export type ModeratorActionType =
  | 'CREATE_MARKET'
  | 'PUBLISH_MARKET'
  | 'UPDATE_MARKET'
  | 'CLOSE_MARKET'
  | 'RESOLVE_MARKET'
  | 'VOID_MARKET'
  | 'ADJUST_BALANCE'
  | 'ARCHIVE_MARKETS'
  | 'PRUNE_MARKETS';

export interface ModeratorActionSnapshot<TBefore = unknown, TAfter = unknown> {
  readonly before: TBefore | null;
  readonly after: TAfter | null;
}

export interface ModeratorActionBase {
  readonly schemaVersion: 1;
  readonly id: ModeratorActionId;
  readonly subredditId: SubredditId;
  readonly performedBy: UserId;
  readonly performedByUsername: string;
  readonly action: ModeratorActionType;
  readonly marketId: MarketId | null;
  readonly targetUserId: UserId | null;
  readonly payload: Record<string, unknown>;
  readonly snapshot?: ModeratorActionSnapshot;
  readonly createdAt: ISODateString;
  readonly correlationId?: string;
}
