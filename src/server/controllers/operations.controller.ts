import { Router } from 'express';
import { asyncHandler } from '../utils/async-handler.js';
import { requireModerator } from '../middleware/auth.js';
import { ValidationError } from '../errors.js';
import type { OperationsService } from '../services/operations.service.js';
import type { ApiSuccessEnvelope, IncidentFeed, MetricsSummary } from '../../shared/types/dto.js';

export interface OperationsControllerDependencies {
  readonly operationsService: OperationsService;
}

const buildMetricsResponse = (summary: MetricsSummary) =>
  ({ data: summary }) satisfies ApiSuccessEnvelope<MetricsSummary>;

const buildIncidentsResponse = (feed: IncidentFeed) =>
  ({ data: feed }) satisfies ApiSuccessEnvelope<IncidentFeed>;

export const registerOperationsRoutes = (
  router: Router,
  dependencies: OperationsControllerDependencies,
): void => {
  router.get(
    '/api/internal/metrics/summary',
    requireModerator,
    asyncHandler(async (req, res) => {
      const context = req.appContext;
      if (!context) {
        throw new ValidationError('Request context unavailable.');
      }

      const summary = await dependencies.operationsService.getMetricsSummary(context.subredditId);
      res.json(buildMetricsResponse(summary));
    }),
  );

  router.get(
    '/api/internal/incidents/recent',
    requireModerator,
    asyncHandler(async (req, res) => {
      const context = req.appContext;
      if (!context) {
        throw new ValidationError('Request context unavailable.');
      }

      const feed = await dependencies.operationsService.getIncidentFeed(context.subredditId);
      res.json(buildIncidentsResponse(feed));
    }),
  );
};
