import { Router } from 'express';
import { z } from 'zod';
import type { MarketId } from '../../shared/types/entities.js';
import {
  MarketIdSchema,
  MarketStatusSchema,
  SubredditIdSchema,
} from '../../shared/schema/entities.schema.js';
import {
  PlaceBetRequestSchema,
  PublishMarketRequestSchema,
  ResolveMarketRequestSchema,
  VoidMarketRequestSchema,
} from '../../shared/schema/dto.schema.js';
import { ensureValid } from '../../shared/validation.js';
import { MarketsService } from '../services/markets.service.js';
import { BetsService } from '../services/bets.service.js';
import { asyncHandler } from '../utils/async-handler.js';
import { UnauthorizedError, ValidationError } from '../errors.js';
import { requireModerator } from '../middleware/auth.js';
import { logger } from '../logging.js';

const listQuerySchema = z
  .object({
    status: MarketStatusSchema.optional(),
    page: z.coerce.number().int().min(1).optional(),
    pageSize: z.coerce.number().int().min(1).max(100).optional(),
  })
  .strict();

const placeBetBodySchema = PlaceBetRequestSchema.pick({ side: true, wager: true });
const resolveMarketBodySchema = ResolveMarketRequestSchema.pick({ resolution: true, notes: true });
const voidMarketBodySchema = VoidMarketRequestSchema.pick({ reason: true });
const publishMarketBodySchema = PublishMarketRequestSchema.pick({ autoCloseOverrideMinutes: true });
const schedulerCloseBodySchema = z
  .object({
    subredditId: SubredditIdSchema,
    marketId: MarketIdSchema,
  })
  .strict();

export interface MarketControllerDependencies {
  readonly marketsService: MarketsService;
  readonly betsService: BetsService;
}

export const registerMarketRoutes = (
  router: Router,
  dependencies: MarketControllerDependencies,
): void => {
  router.get(
    '/api/markets',
    asyncHandler(async (req, res) => {
      const context = req.appContext;
      if (!context) {
        throw new ValidationError('Request context unavailable.');
      }

      const query = ensureValid(listQuerySchema, req.query, 'Invalid query parameters.');
      const optionsCandidate = {
        ...(query.status !== undefined ? { status: query.status } : {}),
        ...(query.page !== undefined ? { page: query.page } : {}),
        ...(query.pageSize !== undefined ? { pageSize: query.pageSize } : {}),
      };

      const options = (Object.keys(optionsCandidate).length > 0
        ? (optionsCandidate as Parameters<MarketsService['list']>[1])
        : undefined);

      const result = await dependencies.marketsService.list(
        context.subredditId,
        options,
        context.userId,
      );

      res.json({ data: result });
    }),
  );

  router.get(
    '/api/markets/:id',
    asyncHandler(async (req, res) => {
      const context = req.appContext;
      if (!context) {
        throw new ValidationError('Request context unavailable.');
      }

      const marketId = req.params.id as MarketId;
      const result = await dependencies.marketsService.getDetail(
        context.subredditId,
        marketId,
        context.userId,
      );

      res.json({ data: result });
    }),
  );

  router.post(
    '/api/markets/:id/bets',
    asyncHandler(async (req, res) => {
      const context = req.appContext;
      if (!context) {
        throw new ValidationError('Request context unavailable.');
      }

      if (!context.userId) {
        throw new UnauthorizedError('User authentication required to place a bet.');
      }

      const marketId = req.params.id as MarketId;
      const payload = ensureValid(placeBetBodySchema, req.body, 'Invalid bet payload.');
      const response = await dependencies.betsService.placeBet(context.subredditId, context.userId, {
        marketId,
        ...payload,
      });

      res.json({ data: response });
    }),
  );

  router.post(
    '/internal/markets/:id/publish',
    requireModerator,
    asyncHandler(async (req, res) => {
      const context = req.appContext;
      if (!context) {
        throw new ValidationError('Request context unavailable.');
      }

      const marketId = req.params.id as MarketId;
      const body = ensureValid(
        publishMarketBodySchema,
        typeof req.body === 'object' && req.body !== null ? req.body : {},
        'Invalid publish payload.',
      );

      const override = Object.prototype.hasOwnProperty.call(body, 'autoCloseOverrideMinutes')
        ? { autoCloseOverrideMinutes: body.autoCloseOverrideMinutes ?? null }
        : {};

      const options = {
        ...(context.userId ? { moderatorId: context.userId } : {}),
        ...override,
      } satisfies Parameters<MarketsService['publishMarket']>[2];

      const result = await dependencies.marketsService.publishMarket(
        context.subredditId,
        marketId,
        options,
      );

      res.json({ data: result });
    }),
  );

  router.post(
    '/internal/markets/:id/close',
    requireModerator,
    asyncHandler(async (req, res) => {
      const context = req.appContext;
      if (!context) {
        throw new ValidationError('Request context unavailable.');
      }

      const marketId = req.params.id as MarketId;
      const options = {
        ...(context.userId ? { moderatorId: context.userId } : {}),
      } satisfies Parameters<MarketsService['closeMarket']>[2];

      const result = await dependencies.marketsService.closeMarket(
        context.subredditId,
        marketId,
        options,
      );

      res.json({ data: result });
    }),
  );

  router.post(
    '/internal/markets/:id/resolve',
    requireModerator,
    asyncHandler(async (req, res) => {
      const context = req.appContext;
      if (!context) {
        throw new ValidationError('Request context unavailable.');
      }

      const marketId = req.params.id as MarketId;
      const payload = ensureValid(resolveMarketBodySchema, req.body, 'Invalid resolution payload.');
      const options = {
        ...(context.userId ? { moderatorId: context.userId } : {}),
        ...(payload.notes !== undefined ? { notes: payload.notes } : {}),
      } satisfies Parameters<MarketsService['resolveMarket']>[3];

      const result = await dependencies.marketsService.resolveMarket(
        context.subredditId,
        marketId,
        payload.resolution,
        options,
      );

      res.json({ data: result.market, meta: { settlement: result.totals } });
    }),
  );

  router.post(
    '/internal/markets/:id/void',
    requireModerator,
    asyncHandler(async (req, res) => {
      const context = req.appContext;
      if (!context) {
        throw new ValidationError('Request context unavailable.');
      }

      const marketId = req.params.id as MarketId;
      const payload = ensureValid(voidMarketBodySchema, req.body, 'Invalid void payload.');
      const options = {
        ...(context.userId ? { moderatorId: context.userId } : {}),
      } satisfies Parameters<MarketsService['voidMarket']>[3];

      const result = await dependencies.marketsService.voidMarket(
        context.subredditId,
        marketId,
        payload.reason,
        options,
      );

      res.json({ data: result.market, meta: { settlement: result.totals } });
    }),
  );

  router.post(
    '/internal/scheduler/market-close',
    asyncHandler(async (req, res) => {
      const payload = ensureValid(
        schedulerCloseBodySchema,
        typeof req.body === 'object' && req.body !== null ? req.body : {},
        'Invalid scheduler payload.',
      );

      const result = await dependencies.marketsService.autoCloseMarket(
        payload.subredditId,
        payload.marketId,
      );

      if (result.status === 'closed') {
        res.json({ data: result.market, meta: { status: 'closed' } });
        return;
      }

      logger.info('scheduler close skipped', {
        subredditId: payload.subredditId,
        marketId: payload.marketId,
        reason: result.reason ?? 'unknown',
      });

      res.json({
        data: result.market ?? null,
        meta: { status: 'skipped', reason: result.reason ?? 'unknown' },
      });
    }),
  );
};
