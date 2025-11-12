import { Router } from 'express';
import { z } from 'zod';
import { BetStatusSchema, UserIdSchema } from '../../shared/schema/entities.schema.js';
import { AdjustBalanceRequestSchema } from '../../shared/schema/dto.schema.js';
import { ensureValid } from '../../shared/validation.js';
import { BetsService } from '../services/bets.service.js';
import { BalanceAdjustmentService } from '../services/balance-adjustment.service.js';
import { asyncHandler } from '../utils/async-handler.js';
import { requireUser, requireModerator } from '../middleware/auth.js';
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
  readonly balanceAdjustmentService: BalanceAdjustmentService;
}

export const registerUserRoutes = (
  router: Router,
  dependencies: UserControllerDependencies,
): void => {
  router.get(
    '/api/session',
    asyncHandler(async (req, res) => {
      const context = req.appContext;
      if (!context) {
        throw new ValidationError('Request context unavailable.');
      }

      res.json({
        data: {
          userId: context.userId ?? null,
          username: context.username ?? null,
          isModerator: context.isModerator,
        },
      });
    }),
  );

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

  router.post(
    ['/internal/users/:userId/adjust-balance', '/api/internal/users/:userId/adjust-balance'],
    requireModerator,
    asyncHandler(async (req, res) => {
      const context = req.appContext;
      if (!context || !context.userId) {
        throw new ValidationError('Request context unavailable.');
      }

      const targetUserId = ensureValid(UserIdSchema, req.params.userId, 'Invalid target user id.');
      const payload = ensureValid(AdjustBalanceRequestSchema, req.body, 'Invalid adjustment payload.');
      const { memo, ...restPayload } = payload;

      const result = await dependencies.balanceAdjustmentService.adjustBalance({
        subredditId: context.subredditId,
        targetUserId,
        moderatorUserId: context.userId,
        moderatorUsername: context.username,
        ...restPayload,
        ...(memo !== undefined ? { memo } : {}),
      });

      res.json({ data: result });
    }),
  );
};
