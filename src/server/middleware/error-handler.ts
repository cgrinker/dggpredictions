import type { ErrorRequestHandler } from 'express';
import { SchemaValidationError } from '../../shared/validation.js';
import { isAppError } from '../errors.js';
import { logger } from '../logging.js';

const buildErrorResponse = (
  code: string,
  message: string,
  details: Record<string, unknown> | undefined,
  correlationId?: string,
) => ({
  error: {
    code,
    message,
    details: {
      ...(details ?? {}),
      ...(correlationId ? { correlationId } : {}),
    },
  },
});

export const errorHandler: ErrorRequestHandler = (error, req, res, _next) => {
  const correlationId = req.correlationId;

  if (error instanceof SchemaValidationError) {
    const payload = error.toErrorPayload();
    res
      .status(400)
      .json(buildErrorResponse(payload.code, payload.message, payload.details, correlationId));
    return;
  }

  if (isAppError(error)) {
    res
      .status(error.status)
      .json(buildErrorResponse(error.code, error.message, error.details as Record<string, unknown> | undefined, correlationId));
    return;
  }

  logger.error('unhandled server error', {
    correlationId,
    message: error instanceof Error ? error.message : 'unknown error',
  });

  res
    .status(500)
    .json(buildErrorResponse('INTERNAL', 'Unexpected server error occurred.', undefined, correlationId));
};
