import type { RequestHandler } from 'express';
import { ForbiddenError, UnauthorizedError } from '../errors.js';

export const requireUser: RequestHandler = (req, _res, next) => {
  const context = req.appContext;
  if (!context || !context.userId) {
    next(new UnauthorizedError('User authentication required.'));
    return;
  }
  next();
};

export const requireModerator: RequestHandler = (req, _res, next) => {
  const context = req.appContext;
  if (!context) {
    next(new UnauthorizedError('User authentication required.'));
    return;
  }

  if (!context.isModerator) {
    next(new ForbiddenError('Moderator privileges required.'));
    return;
  }

  next();
};
