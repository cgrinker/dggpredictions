import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';

export const tracingMiddleware: RequestHandler = (req, res, next) => {
  const correlationId = randomUUID();
  req.correlationId = correlationId;
  res.setHeader('x-correlation-id', correlationId);
  next();
};
