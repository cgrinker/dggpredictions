import express, { Router, type Request } from 'express';
import supertest, { type SuperTest, type Test as SupertestRequest } from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { MarketControllerDependencies } from '../markets.controller.js';
import { registerMarketRoutes } from '../markets.controller.js';
import { errorHandler } from '../../middleware/error-handler.js';
import type { RequestContext } from '../../context.js';
import type { MarketsService } from '../../services/markets.service.js';
import type { BetsService } from '../../services/bets.service.js';
import type { Market, SubredditId, UserId } from '../../../shared/types/entities.js';

type VitestMock = ReturnType<typeof vi.fn>;

const defaultContext: RequestContext = {
  subredditId: 'sub-1' as SubredditId,
  subredditName: 'example-subreddit',
  userId: 'mod-1' as UserId,
  username: 'mod-1',
  isModerator: true,
  config: null,
};

const createApp = (
  dependencies: MarketControllerDependencies,
  contextOverrides: Partial<RequestContext> = {},
) => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as Request & { appContext: RequestContext }).appContext = {
      ...defaultContext,
      ...contextOverrides,
    } satisfies RequestContext;
    next();
  });

  const router = Router();
  registerMarketRoutes(router, dependencies);
  app.use(router);
  app.use(errorHandler);

  return app;
};

const createDependencies = () => {
  const marketsService: Partial<MarketsService> = {
    createDraft: vi.fn(),
    archiveMarkets: vi.fn(),
  };

  const betsService: Partial<BetsService> = {};

  return {
    dependencies: {
      marketsService: marketsService as MarketsService,
      betsService: betsService as BetsService,
    } satisfies MarketControllerDependencies,
    marketsService,
  };
};

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('MarketsController archive route', () => {
  it('archives markets with validated payload', async () => {
    vi.useFakeTimers();
    const now = new Date('2025-02-01T00:00:00.000Z');
    vi.setSystemTime(now);

    const archiveResult = {
      processedMarkets: 5,
      archivedMarkets: 3,
      skippedMarkets: 2,
      cutoffIso: '2025-01-02T00:00:00.000Z',
      dryRun: false,
    };

    const { dependencies, marketsService } = createDependencies();
    (marketsService.archiveMarkets as VitestMock).mockResolvedValue(archiveResult);

    const app = createApp(dependencies, {});
    const agent: SuperTest<SupertestRequest> = supertest(app);

    const response = await agent
      .post('/internal/markets/archive')
      .send({
        olderThanDays: 30,
        statuses: ['resolved', 'void'],
        maxMarkets: 100,
      })
      .expect(200);

    expect(response.body.data).toEqual(archiveResult);

    expect(marketsService.archiveMarkets).toHaveBeenCalledTimes(1);
    const callArgs = (marketsService.archiveMarkets as VitestMock).mock.calls[0];
    expect(callArgs[0]).toBe(defaultContext.subredditId);

    const options = callArgs[1] as Parameters<MarketsService['archiveMarkets']>[1];
    const expectedCutoff = new Date(now.getTime() - 30 * 86_400_000);
    expect(options.cutoff.toISOString()).toBe(expectedCutoff.toISOString());
    expect(options.statuses).toEqual(['resolved', 'void']);
    expect(options.maxMarkets).toBe(100);
    expect(options.dryRun).toBeUndefined();
    expect(options.moderatorId).toBe(defaultContext.userId);
  });

  it('supports dry-run mode for archive requests', async () => {
    vi.useFakeTimers();
    const now = new Date('2025-03-10T12:00:00.000Z');
    vi.setSystemTime(now);

    const archiveResult = {
      processedMarkets: 12,
      archivedMarkets: 0,
      skippedMarkets: 12,
      cutoffIso: '2025-02-08T12:00:00.000Z',
      dryRun: true,
    };

    const { dependencies, marketsService } = createDependencies();
    (marketsService.archiveMarkets as VitestMock).mockResolvedValue(archiveResult);

    const app = createApp(dependencies, {});
    const agent: SuperTest<SupertestRequest> = supertest(app);

    const response = await agent
      .post('/internal/markets/archive')
      .send({
        olderThanDays: 30,
        statuses: ['closed'],
        dryRun: true,
      })
      .expect(200);

    expect(response.body.data).toEqual(archiveResult);

    expect(marketsService.archiveMarkets).toHaveBeenCalledTimes(1);
    const callArgs = (marketsService.archiveMarkets as VitestMock).mock.calls[0];
    expect(callArgs[0]).toBe(defaultContext.subredditId);

    const options = callArgs[1] as Parameters<MarketsService['archiveMarkets']>[1];
    const expectedCutoff = new Date(now.getTime() - 30 * 86_400_000);
    expect(options.cutoff.toISOString()).toBe(expectedCutoff.toISOString());
    expect(options.statuses).toEqual(['closed']);
    expect(options.dryRun).toBe(true);
    expect(options.moderatorId).toBe(defaultContext.userId);
  });

  it('rejects invalid payloads with validation error', async () => {
    const { dependencies, marketsService } = createDependencies();
    const app = createApp(dependencies, {});
    const agent: SuperTest<SupertestRequest> = supertest(app);

    const response = await agent
      .post('/internal/markets/archive')
      .send({})
      .expect(400);

    expect(response.body.error).toBeDefined();
    expect(response.body.error.code).toBe('VALIDATION_FAILED');
    expect(Array.isArray(response.body.error.details?.issues)).toBe(true);
    expect(marketsService.archiveMarkets).not.toHaveBeenCalled();
  });
});

describe('MarketsController create route', () => {
  it('creates draft market with moderator context', async () => {
    const createdMarket: Market = {
      schemaVersion: 1,
      id: 'market-123' as Market['id'],
      subredditId: defaultContext.subredditId,
      title: 'Test Market',
      description: 'Description',
      createdBy: defaultContext.userId!,
      createdAt: new Date().toISOString(),
      closesAt: new Date(Date.now() + 60_000).toISOString(),
      resolvedAt: null,
      status: 'draft',
      resolution: null,
      potYes: 0,
      potNo: 0,
      totalBets: 0,
    };

    const { dependencies, marketsService } = createDependencies();
    (marketsService.createDraft as VitestMock).mockResolvedValue(createdMarket);

    const app = createApp(dependencies, {});
    const agent: SuperTest<SupertestRequest> = supertest(app);

    const payload = {
      title: 'Test Market',
      description: 'Description',
      closesAt: createdMarket.closesAt,
      tags: ['tag1', 'tag2'],
    };

    const response = await agent.post('/internal/markets').send(payload).expect(201);

    expect(response.body.data).toEqual(createdMarket);
    expect(marketsService.createDraft).toHaveBeenCalledTimes(1);
    const [subredditId, moderatorId, requestBody, options] = (
      marketsService.createDraft as VitestMock
    ).mock.calls[0] as Parameters<MarketsService['createDraft']>;
    expect(subredditId).toBe(defaultContext.subredditId);
    expect(moderatorId).toBe(defaultContext.userId);
    expect(requestBody).toMatchObject({
      title: payload.title,
      description: payload.description,
      closesAt: payload.closesAt,
      tags: payload.tags,
    });
    expect(options).toEqual({ creatorUsername: defaultContext.username });
  });

  it('rejects creation when request context missing user', async () => {
    const { dependencies, marketsService } = createDependencies();
    const app = createApp(dependencies, { userId: null });
    const agent: SuperTest<SupertestRequest> = supertest(app);

    await agent
      .post('/internal/markets')
      .send({
        title: 'Test',
        description: 'Desc',
        closesAt: new Date(Date.now() + 60_000).toISOString(),
      })
      .expect(400);

    expect(marketsService.createDraft).not.toHaveBeenCalled();
  });
});
