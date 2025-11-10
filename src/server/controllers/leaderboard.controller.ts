import { Router } from 'express';
import { z } from 'zod';
import { ensureValid } from '../../shared/validation.js';
import { asyncHandler } from '../utils/async-handler.js';
import { ValidationError } from '../errors.js';
import { LeaderboardService } from '../services/leaderboard.service.js';

const leaderboardQuerySchema = z
  .object({
    window: z.enum(['weekly', 'monthly', 'alltime']).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
  })
  .strict();

export interface LeaderboardControllerDependencies {
  readonly leaderboardService: LeaderboardService;
}

export const registerLeaderboardRoutes = (
  router: Router,
  dependencies: LeaderboardControllerDependencies,
): void => {
  router.get(
    '/api/leaderboard',
    asyncHandler(async (req, res) => {
      const context = req.appContext;
      if (!context) {
        throw new ValidationError('Request context unavailable.');
      }

      const query = ensureValid(leaderboardQuerySchema, req.query, 'Invalid query parameters.');
      const optionsCandidate = {
        ...(query.window !== undefined ? { window: query.window } : {}),
        ...(query.limit !== undefined ? { limit: query.limit } : {}),
      } satisfies Partial<Parameters<LeaderboardService['getLeaderboard']>[2]>;

      const options =
        Object.keys(optionsCandidate).length > 0
          ? (optionsCandidate as Parameters<LeaderboardService['getLeaderboard']>[2])
          : undefined;

      const result = await dependencies.leaderboardService.getLeaderboard(
        context.subredditId,
        context.userId,
        options,
      );

      res.json({ data: result });
    }),
  );
};
