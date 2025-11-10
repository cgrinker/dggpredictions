export type ErrorCode =
  | 'MARKET_NOT_FOUND'
  | 'MARKET_NOT_OPEN'
  | 'MARKET_ALREADY_RESOLVED'
  | 'BET_ALREADY_EXISTS'
  | 'BET_LIMIT_EXCEEDED'
  | 'INSUFFICIENT_BALANCE'
  | 'INVALID_WAGER'
  | 'UNAUTHORIZED'
  | 'VALIDATION_FAILED'
  | 'RESOURCE_CONFLICT'
  | 'INTERNAL_ERROR';

export interface ErrorPayload {
  readonly code: ErrorCode;
  readonly message: string;
  readonly details?: Record<string, unknown>;
}
