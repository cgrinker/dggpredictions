import type {
  Bet,
  BetSide,
  LeaderboardEntry,
  Market,
  MarketId,
  MarketStatus,
  Points,
  ISODateString,
  UserBalance,
} from './entities.js';
import type { AppConfig } from './config.js';
import type { ModeratorActionBase } from './moderation.js';

export interface Pagination {
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
}

export interface PaginatedResponse<T> {
  readonly data: readonly T[];
  readonly pagination: Pagination;
}

export interface MarketSummary
  extends Pick<Market, 'id' | 'title' | 'status' | 'closesAt' | 'potYes' | 'potNo' | 'totalBets' | 'imageUrl'> {
  readonly impliedYesProbability: number;
  readonly impliedNoProbability: number;
  readonly metadata?: Market['metadata'];
}

export type BetHistoryInterval = 'hour' | 'day' | 'week' | 'month';

export interface BetHistoryPoint {
  readonly start: ISODateString;
  readonly end: ISODateString;
  readonly cumulativePotYes: Points;
  readonly cumulativePotNo: Points;
  readonly cumulativeBets: number;
}

export interface MarketBetHistorySeries {
  readonly interval: BetHistoryInterval;
  readonly points: readonly BetHistoryPoint[];
}

export interface MarketBetHistoryResponse {
  readonly marketId: MarketId;
  readonly intervals: readonly MarketBetHistorySeries[];
}

export interface MarketDetail extends Market {
  readonly userBet: Bet | null;
}

export interface BetSummary extends Pick<Bet, 'id' | 'marketId' | 'side' | 'wager' | 'status' | 'createdAt' | 'payout' | 'settledAt'> {
  readonly marketTitle: string;
  readonly marketStatus: MarketStatus;
}

export interface WalletSnapshot extends Pick<UserBalance, 'userId' | 'subredditId' | 'balance' | 'lifetimeEarned' | 'lifetimeLost' | 'weeklyEarned' | 'monthlyEarned' | 'updatedAt'> {
  readonly activeBets: number;
}

export interface SessionInfo {
  readonly userId: string | null;
  readonly username: string | null;
  readonly isModerator: boolean;
  readonly config: AppConfig | null;
}

export interface MetricsSummary {
  readonly counters: Record<string, number>;
  readonly updatedAt: ISODateString;
}

export interface IncidentSummary {
  readonly id: string;
  readonly severity: 'info' | 'warning' | 'error';
  readonly message: string;
  readonly createdAt: ISODateString;
}

export interface IncidentFeed {
  readonly incidents: readonly IncidentSummary[];
  readonly fetchedAt: ISODateString;
}

export interface SystemResetResponse {
  readonly attemptedKeys: number;
  readonly deletedKeys: number;
  readonly errors: number;
}

export interface PlaceBetRequest {
  readonly marketId: MarketId;
  readonly side: BetSide;
  readonly wager: Points;
}

export interface PlaceBetResponse {
  readonly bet: Bet;
  readonly balance: WalletSnapshot;
  readonly market: MarketDetail;
}

export interface CreateMarketRequest {
  readonly title: string;
  readonly description: string;
  readonly closesAt: string;
  readonly imageUrl?: string;
  readonly tags?: readonly string[];
}

export interface MarketStateChangeRequest {
  readonly marketId: MarketId;
}

export interface PublishMarketRequest extends MarketStateChangeRequest {
  readonly autoCloseOverrideMinutes?: number | null;
}

export interface ArchiveMarketsRequest {
  readonly olderThanDays: number;
  readonly statuses?: ReadonlyArray<MarketStatus>;
  readonly maxMarkets?: number;
  readonly dryRun?: boolean;
  readonly page?: number;
  readonly pageSize?: number;
}

export interface ArchiveMarketsResponse {
  readonly processedMarkets: number;
  readonly archivedMarkets: number;
  readonly skippedMarkets: number;
  readonly cutoffIso: string;
  readonly dryRun: boolean;
  readonly candidates: readonly MarketSummary[];
  readonly pagination: Pagination;
}

export interface ConfigState {
  readonly config: AppConfig;
  readonly overridesApplied: boolean;
}

export interface ResolveMarketRequest extends MarketStateChangeRequest {
  readonly resolution: BetSide;
  readonly notes?: string;
}

export interface VoidMarketRequest extends MarketStateChangeRequest {
  readonly reason: string;
}

export interface MarketSettlementMeta {
  readonly settledBets: number;
  readonly winners: number;
  readonly refunded: number;
  readonly totalPayout: Points;
}

export interface AuditLogResponse {
  readonly actions: readonly ModeratorActionLogEntry[];
  readonly fetchedAt: string;
}

export type ModeratorActionLogEntry = ModeratorActionBase;

export type BalanceAdjustmentMode = 'credit' | 'debit';

export type BalanceAdjustmentReasonCode =
  | 'DISPUTE_REFUND'
  | 'BUG_FIX'
  | 'MOD_REWARD'
  | 'OTHER';

export interface AdjustBalanceRequest {
  readonly delta: Points;
  readonly mode: BalanceAdjustmentMode;
  readonly reasonCode: BalanceAdjustmentReasonCode;
  readonly memo?: string;
}

export interface AdjustBalanceResponse {
  readonly balance: UserBalance;
  readonly auditAction: ModeratorActionLogEntry;
}

export interface LeaderboardResponse {
  readonly window: 'weekly' | 'monthly' | 'alltime';
  readonly asOf: string;
  readonly entries: readonly LeaderboardEntry[];
  readonly currentUser?: LeaderboardEntry;
}

export interface ApiSuccessEnvelope<T> {
  readonly data: T;
  readonly meta?: Record<string, unknown>;
}

export interface ApiErrorEnvelope {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly details?: Record<string, unknown>;
  };
}

export type PlaceBetResponseEnvelope = ApiSuccessEnvelope<PlaceBetResponse>;
export type MarketListResponse = ApiSuccessEnvelope<PaginatedResponse<MarketSummary>>;
export type MarketDetailResponse = ApiSuccessEnvelope<MarketDetail>;
export type MarketBetHistoryResponseEnvelope = ApiSuccessEnvelope<MarketBetHistoryResponse>;
export type WalletResponse = ApiSuccessEnvelope<WalletSnapshot>;
export type UserBetsResponse = ApiSuccessEnvelope<PaginatedResponse<BetSummary>>;
export type LeaderboardResponseEnvelope = ApiSuccessEnvelope<LeaderboardResponse>;
export type ArchiveMarketsResponseEnvelope = ApiSuccessEnvelope<ArchiveMarketsResponse>;
export type ConfigResponseEnvelope = ApiSuccessEnvelope<ConfigState>;
export type ResolveMarketResponseEnvelope = ApiSuccessEnvelope<Market> & {
  readonly meta?: {
    readonly settlement?: MarketSettlementMeta;
  };
};
export type AuditLogResponseEnvelope = ApiSuccessEnvelope<AuditLogResponse>;
export type AdjustBalanceResponseEnvelope = ApiSuccessEnvelope<AdjustBalanceResponse>;
export type SessionResponseEnvelope = ApiSuccessEnvelope<SessionInfo>;
export type SystemResetResponseEnvelope = ApiSuccessEnvelope<SystemResetResponse>;
