import { Router } from 'express';
import { z } from 'zod';
import { BetStatusSchema } from '../../shared/schema/entities.schema.js';
import { ensureValid } from '../../shared/validation.js';
import { BetsService } from '../services/bets.service.js';
import { asyncHandler } from '../utils/async-handler.js';
import { requireUser } from '../middleware/auth.js';
import { ValidationError } from '../errors.js';

const listBetsQuerySchema = z
  .object({
    status: BetStatusSchema.optional(),
    page: z.coerce.number().int().min(1).optional(),
    pageSize: z.coerce.number().int().min(1).max(100).optional(),
  })
  .strict();

export interface UserControllerDependencies {
  readonly betsService: BetsService;
}

export const registerUserRoutes = (
  router: Router,
  dependencies: UserControllerDependencies,
): void => {
  router.get(
    '/api/users/me/balance',
    requireUser,
    asyncHandler(async (req, res) => {
      const context = req.appContext;
      if (!context || !context.userId) {
        throw new ValidationError('Request context unavailable.');
      }

      const snapshot = await dependencies.betsService.getWallet(context.subredditId, context.userId);
      res.json({ data: snapshot });
    }),
  );

  router.get(
    '/api/users/me/bets',
    requireUser,
    asyncHandler(async (req, res) => {
      const context = req.appContext;
      if (!context || !context.userId) {
        throw new ValidationError('Request context unavailable.');
      }

      const query = ensureValid(listBetsQuerySchema, req.query, 'Invalid query parameters.');
      const optionsCandidate = {
        ...(query.status !== undefined ? { status: query.status } : {}),
        ...(query.page !== undefined ? { page: query.page } : {}),
        ...(query.pageSize !== undefined ? { pageSize: query.pageSize } : {}),
      } satisfies Partial<Parameters<BetsService['listUserBets']>[2]>;

      const options =
        Object.keys(optionsCandidate).length > 0
          ? (optionsCandidate as Parameters<BetsService['listUserBets']>[2])
          : undefined;

      const result = await dependencies.betsService.listUserBets(
        context.subredditId,
        context.userId,
        options,
      );

      res.json({ data: result });
    }),
  );
};
