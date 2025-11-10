export type ErrorCode =
  | 'VALIDATION'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'INTERNAL';

type ErrorOptions = {
  readonly cause?: unknown;
  readonly details?: unknown;
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(message: string, code: ErrorCode, status: number, options?: ErrorOptions) {
    super(message, { cause: options?.cause });
    this.code = code;
    this.status = status;
    this.details = options?.details;
    this.name = this.constructor.name;
  }
}

export class ValidationError extends AppError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, 'VALIDATION', 400, options);
  }
}

export class ForbiddenError extends AppError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, 'FORBIDDEN', 403, options);
  }
}

export class NotFoundError extends AppError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, 'NOT_FOUND', 404, options);
  }
}

export class ConflictError extends AppError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, 'CONFLICT', 409, options);
  }
}

export class RateLimitError extends AppError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, 'RATE_LIMITED', 429, options);
  }
}

export class InternalError extends AppError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, 'INTERNAL', 500, options);
  }
}

export const isAppError = (error: unknown): error is AppError => error instanceof AppError;
