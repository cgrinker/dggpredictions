import express, { Router, type Request } from 'express';
import supertest, { type SuperTest, type Test as SupertestRequest } from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { registerOperationsRoutes } from '../operations.controller.js';
import type { OperationsControllerDependencies } from '../operations.controller.js';
import { errorHandler } from '../../middleware/error-handler.js';
import type { RequestContext } from '../../context.js';
import type { IncidentFeed, MetricsSummary, SystemResetResponse } from '../../../shared/types/dto.js';
import type { SubredditId, UserId } from '../../../shared/types/entities.js';
import type { OperationsService } from '../../services/operations.service.js';

type VitestMock = ReturnType<typeof vi.fn>;

afterEach(() => {
  vi.clearAllMocks();
});

const defaultContext: RequestContext = {
  subredditId: 'sub-123' as SubredditId,
  subredditName: 'example-subreddit',
  userId: 'user-1' as UserId,
  username: 'moderator',
  isModerator: true,
  config: null,
};

const createApp = (
  dependencies: OperationsControllerDependencies,
  overrides: Partial<RequestContext> = {},
) => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as Request & { appContext: RequestContext }).appContext = {
      ...defaultContext,
      ...overrides,
    } satisfies RequestContext;
    next();
  });

  const router = Router();
  registerOperationsRoutes(router, dependencies);
  app.use(router);
  app.use(errorHandler);
  return app;
};

describe('OperationsController', () => {
  it('returns metrics summary for moderators', async () => {
    const summary: MetricsSummary = {
      counters: {
        totalMarkets: 10,
        openMarkets: 4,
        resolvedMarkets: 3,
        closedMarkets: 2,
        draftMarkets: 1,
        voidMarkets: 0,
      },
      updatedAt: '2025-11-11T00:00:00.000Z',
    };

    const operationsService: Partial<OperationsService> = {
      getMetricsSummary: vi.fn().mockResolvedValue(summary),
      getIncidentFeed: vi.fn(),
      resetSystem: vi.fn(),
    };

    const app = createApp({ operationsService: operationsService as OperationsService });
    const agent: SuperTest<SupertestRequest> = supertest(app);

    const response = await agent.get('/api/internal/metrics/summary').expect(200);

    expect(response.body.data).toEqual(summary);
    expect((operationsService.getMetricsSummary as VitestMock)).toHaveBeenCalledWith(
      defaultContext.subredditId,
    );
  });

  it('returns incident feed for moderators', async () => {
    const feed: IncidentFeed = {
      incidents: [
        {
          id: 'incident-1',
          severity: 'warning',
          message: 'Redis latency spike detected',
          createdAt: '2025-11-10T22:33:00.000Z',
        },
      ],
      fetchedAt: '2025-11-11T00:05:00.000Z',
    };

    const operationsService: Partial<OperationsService> = {
      getMetricsSummary: vi.fn(),
      getIncidentFeed: vi.fn().mockResolvedValue(feed),
      resetSystem: vi.fn(),
    };

    const app = createApp({ operationsService: operationsService as OperationsService });
    const agent: SuperTest<SupertestRequest> = supertest(app);

    const response = await agent.get('/api/internal/incidents/recent').expect(200);

    expect(response.body.data).toEqual(feed);
    expect((operationsService.getIncidentFeed as VitestMock)).toHaveBeenCalledWith(
      defaultContext.subredditId,
    );
  });

  it('rejects non-moderators with forbidden error', async () => {
    const operationsService: Partial<OperationsService> = {
      getMetricsSummary: vi.fn(),
      getIncidentFeed: vi.fn(),
      resetSystem: vi.fn(),
    };

    const app = createApp(
      { operationsService: operationsService as OperationsService },
      { isModerator: false },
    );
    const agent: SuperTest<SupertestRequest> = supertest(app);

    const response = await agent.get('/api/internal/metrics/summary').expect(403);

    expect(response.body.error?.code).toBe('FORBIDDEN');
    expect(operationsService.getMetricsSummary).not.toHaveBeenCalled();
  });

  it('resets system when moderator confirms action', async () => {
    const resetSummary: SystemResetResponse = {
      attemptedKeys: 10,
      deletedKeys: 9,
      errors: 1,
    };

    const operationsService: Partial<OperationsService> = {
      getMetricsSummary: vi.fn(),
      getIncidentFeed: vi.fn(),
      resetSystem: vi.fn().mockResolvedValue(resetSummary),
    };

    const app = createApp({ operationsService: operationsService as OperationsService });
    const agent: SuperTest<SupertestRequest> = supertest(app);

    const response = await agent
      .post('/api/internal/system/reset')
      .send({ confirm: true })
      .expect(200);

    expect(response.body.data).toEqual(resetSummary);
    expect((operationsService.resetSystem as VitestMock)).toHaveBeenCalledWith(
      defaultContext.subredditId,
      expect.objectContaining({
        moderatorId: defaultContext.userId,
        moderatorUsername: defaultContext.username,
      }),
    );
  });

  it('rejects reset requests without confirmation', async () => {
    const operationsService: Partial<OperationsService> = {
      getMetricsSummary: vi.fn(),
      getIncidentFeed: vi.fn(),
      resetSystem: vi.fn(),
    };

    const app = createApp({ operationsService: operationsService as OperationsService });
    const agent: SuperTest<SupertestRequest> = supertest(app);

    const response = await agent.post('/api/internal/system/reset').send({}).expect(400);

  expect(response.body.error?.code).toBe('VALIDATION_FAILED');
    expect(operationsService.resetSystem).not.toHaveBeenCalled();
  });

  it('rejects reset when moderator identity missing', async () => {
    const operationsService: Partial<OperationsService> = {
      getMetricsSummary: vi.fn(),
      getIncidentFeed: vi.fn(),
      resetSystem: vi.fn(),
    };

    const app = createApp(
      { operationsService: operationsService as OperationsService },
      { userId: null },
    );
    const agent: SuperTest<SupertestRequest> = supertest(app);

    const response = await agent
      .post('/api/internal/system/reset')
      .send({ confirm: true })
      .expect(400);

  expect(response.body.error?.code).toBe('VALIDATION');
    expect(operationsService.resetSystem).not.toHaveBeenCalled();
  });
});
