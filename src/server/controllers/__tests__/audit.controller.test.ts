import express, { Router, type Request } from 'express';
import supertest, { type SuperTest, type Test as SupertestRequest } from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { registerAuditRoutes, type AuditControllerDependencies } from '../audit.controller.js';
import { errorHandler } from '../../middleware/error-handler.js';
import type { RequestContext } from '../../context.js';
import type { AuditLogService } from '../../services/audit-log.service.js';
import type { ModeratorActionBase } from '../../../shared/types/moderation.js';
import type { MarketId, SubredditId, UserId } from '../../../shared/types/entities.js';

type VitestMock = ReturnType<typeof vi.fn>;

const defaultContext: RequestContext = {
  subredditId: 'sub-1' as SubredditId,
  subredditName: 'example-subreddit',
  userId: 'mod-1' as UserId,
  username: 'mod-user',
  isModerator: true,
  config: null,
};

const createApp = (
  dependencies: AuditControllerDependencies,
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
  registerAuditRoutes(router, dependencies);
  app.use(router);
  app.use(errorHandler);

  return app;
};

const createDependencies = () => {
  const auditLogService: Partial<AuditLogService> = {
    listRecent: vi.fn(),
  };

  return {
    dependencies: {
      auditLogService: auditLogService as AuditLogService,
    } satisfies AuditControllerDependencies,
    auditLogService,
  };
};

afterEach(() => {
  vi.clearAllMocks();
});

describe('AuditController logs route', () => {
  it('returns recent moderator actions when moderator authenticated', async () => {
    const sampleAction: ModeratorActionBase = {
      schemaVersion: 1,
      id: 'act-1' as ModeratorActionBase['id'],
      subredditId: defaultContext.subredditId,
      performedBy: defaultContext.userId as UserId,
      performedByUsername: defaultContext.username ?? 'mod-user',
      action: 'PUBLISH_MARKET',
      marketId: 'market-1' as MarketId,
      targetUserId: null,
      payload: { autoCloseOverrideMinutes: 5 },
      createdAt: new Date('2025-01-01T00:00:00.000Z').toISOString(),
    };

    const { dependencies, auditLogService } = createDependencies();
  (auditLogService.listRecent as VitestMock).mockResolvedValue([sampleAction]);

    const app = createApp(dependencies);
    const agent: SuperTest<SupertestRequest> = supertest(app);

    const response = await agent.get('/internal/audit/logs?limit=25').expect(200);

    expect(Array.isArray(response.body.data.actions)).toBe(true);
    expect(response.body.data.actions).toEqual([sampleAction]);
    expect(typeof response.body.data.fetchedAt).toBe('string');

    expect(auditLogService.listRecent).toHaveBeenCalledTimes(1);
    expect(auditLogService.listRecent).toHaveBeenCalledWith(defaultContext.subredditId, { limit: 25 });
  });

  it('rejects non-moderator access with forbidden error', async () => {
    const { dependencies, auditLogService } = createDependencies();
    const app = createApp(dependencies, { isModerator: false });
    const agent: SuperTest<SupertestRequest> = supertest(app);

    const response = await agent.get('/internal/audit/logs').expect(403);

    expect(response.body.error).toBeDefined();
    expect(response.body.error.code).toBe('FORBIDDEN');
    expect(auditLogService.listRecent).not.toHaveBeenCalled();
  });

  it('validates query parameters before invoking service', async () => {
    const { dependencies, auditLogService } = createDependencies();
    const app = createApp(dependencies);
    const agent: SuperTest<SupertestRequest> = supertest(app);

    const response = await agent.get('/internal/audit/logs?limit=abc').expect(400);

    expect(response.body.error).toBeDefined();
    expect(response.body.error.code).toBe('VALIDATION_FAILED');
    expect(auditLogService.listRecent).not.toHaveBeenCalled();
  });
});
