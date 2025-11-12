import type { RequestHandler } from 'express';
import { ConfigService } from '../services/config.service.js';
import { UserDirectoryService } from '../services/user-directory.service.js';
import { buildRequestContext } from '../context.js';
import { logger } from '../logging.js';

export const createContextMiddleware = (
  configService: ConfigService,
  userDirectory: UserDirectoryService,
): RequestHandler => {
  return async (req, _res, next) => {
    try {
      const context = await buildRequestContext((subredditId) => configService.getConfig(subredditId));
      await userDirectory.rememberUser(context.subredditId, context.userId, context.username);
      req.appContext = context;
      next();
    } catch (error) {
      logger.error('failed to build request context', {
        message: error instanceof Error ? error.message : 'unknown error',
      });
      next(error);
    }
  };
};
