import { Router } from 'express';
import {
  registerMarketRoutes,
  type MarketControllerDependencies,
} from './controllers/markets.controller.js';
import {
  registerUserRoutes,
  type UserControllerDependencies,
} from './controllers/users.controller.js';
import {
  registerLeaderboardRoutes,
  type LeaderboardControllerDependencies,
} from './controllers/leaderboard.controller.js';
import {
  registerAuditRoutes,
  type AuditControllerDependencies,
} from './controllers/audit.controller.js';
import {
  registerConfigRoutes,
  type ConfigControllerDependencies,
} from './controllers/config.controller.js';
import { asyncHandler } from './utils/async-handler.js';
import { createPost } from './core/post.js';
import { context } from '@devvit/web/server';
import { logger } from './logging.js';

export type RouterDependencies = MarketControllerDependencies &
  UserControllerDependencies &
  LeaderboardControllerDependencies &
  AuditControllerDependencies &
  ConfigControllerDependencies;

export const createAppRouter = (dependencies: RouterDependencies): Router => {
  const router = Router();

  registerMarketRoutes(router, dependencies);
  registerUserRoutes(router, dependencies);
  registerLeaderboardRoutes(router, dependencies);
  registerAuditRoutes(router, dependencies);
  registerConfigRoutes(router, dependencies);

  router.post(
    '/internal/on-app-install',
    asyncHandler(async (_req, res) => {
      try {
        const post = await createPost();
        res.json({
          status: 'success',
          message: `Post created in subreddit ${context.subredditName} with id ${post.id}`,
        });
      } catch (error) {
        logger.error('failed to create post on install', {
          message: error instanceof Error ? error.message : 'unknown error',
        });
        res.status(400).json({
          status: 'error',
          message: 'Failed to create post',
        });
      }
    }),
  );

  router.post(
    '/internal/menu/post-create',
    asyncHandler(async (_req, res) => {
      try {
        const post = await createPost();
        res.json({
          navigateTo: `https://reddit.com/r/${context.subredditName}/comments/${post.id}`,
        });
      } catch (error) {
        logger.error('failed to create post from menu', {
          message: error instanceof Error ? error.message : 'unknown error',
        });
        res.status(400).json({
          status: 'error',
          message: 'Failed to create post',
        });
      }
    }),
  );

  return router;
};
