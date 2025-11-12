import express, { Router, type Request } from 'express';
import supertest, { type SuperTest, type Test as SupertestRequest } from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { registerConfigRoutes } from '../config.controller.js';
import type { ConfigControllerDependencies } from '../config.controller.js';
import { errorHandler } from '../../middleware/error-handler.js';
import type { RequestContext } from '../../context.js';
import type { ConfigService } from '../../services/config.service.js';
import type { AppConfig } from '../../../shared/types/config.js';
import type { SubredditId, UserId } from '../../../shared/types/entities.js';
import type { AuditLogService } from '../../services/audit-log.service.js';

type VitestMock = ReturnType<typeof vi.fn>;

const defaultContext: RequestContext = {
  subredditId: 'sub-123' as SubredditId,
  subredditName: 'example-subreddit',
  userId: 'user-1' as UserId,
  username: 'mod-user',
  isModerator: true,
  config: null,
};

const sampleConfig: AppConfig = {
  startingBalance: 1_000,
  minBet: 10,
  maxBet: 5_000,
  maxOpenMarkets: 250,
  leaderboardWindow: 'weekly',
  autoCloseGraceMinutes: 30,
  featureFlags: {
    maintenanceMode: false,
    enableRealtimeUpdates: true,
    enableLeaderboard: true,
    enableConfigEditor: true,
  },
};

const createDependencies = () => {
  const configService: Partial<ConfigService> = {
    getConfig: vi.fn(),
    hasOverride: vi.fn(),
    updateConfig: vi.fn(),
    clearOverride: vi.fn(),
  };
  const auditLogService: Partial<AuditLogService> = {
    recordAction: vi.fn(),
  };

  return {
    dependencies: {
      configService: configService as ConfigService,
      auditLogService: auditLogService as AuditLogService,
    } satisfies ConfigControllerDependencies,
    configService,
    auditLogService,
  };
};

const createApp = (
  dependencies: ConfigControllerDependencies,
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
  registerConfigRoutes(router, dependencies);
  app.use(router);
  app.use(errorHandler);
  return app;
};

afterEach(() => {
  vi.clearAllMocks();
});

describe('ConfigController', () => {
  describe('GET /api/internal/config', () => {
    it('returns current config and override status', async () => {
      const { dependencies, configService, auditLogService } = createDependencies();
      (configService.getConfig as VitestMock).mockResolvedValue(sampleConfig);
      (configService.hasOverride as VitestMock).mockResolvedValue(true);

      const app = createApp(dependencies);
      const agent: SuperTest<SupertestRequest> = supertest(app);

      const response = await agent.get('/api/internal/config').expect(200);

      expect(response.body.data.config).toEqual(sampleConfig);
      expect(response.body.data.overridesApplied).toBe(true);

      expect(configService.getConfig).toHaveBeenCalledWith(defaultContext.subredditId);
      expect(configService.hasOverride).toHaveBeenCalledWith(defaultContext.subredditId);
      expect(auditLogService.recordAction as VitestMock).not.toHaveBeenCalled();
    });
  });

  describe('POST /api/internal/config', () => {
    it('updates overrides and returns fresh config', async () => {
      const { dependencies, configService, auditLogService } = createDependencies();
      (configService.updateConfig as VitestMock).mockResolvedValue(sampleConfig);

      const app = createApp(dependencies);
      const agent: SuperTest<SupertestRequest> = supertest(app);

      const response = await agent.post('/api/internal/config').send(sampleConfig).expect(200);

      expect(response.body.data.config).toEqual(sampleConfig);
      expect(response.body.data.overridesApplied).toBe(true);
      expect(configService.updateConfig).toHaveBeenCalledWith(
        defaultContext.subredditId,
        sampleConfig,
      );
      expect(auditLogService.recordAction).toHaveBeenCalledWith(defaultContext.subredditId, {
        performedBy: defaultContext.userId,
        performedByUsername: defaultContext.username,
        action: 'CONFIG_UPDATE',
        marketId: null,
        payload: {
          mode: 'update',
          overridesApplied: true,
          config: sampleConfig,
        },
      });
    });
  });

  describe('DELETE /api/internal/config', () => {
    it('clears overrides and reports defaults', async () => {
      const resetConfig: AppConfig = {
        ...sampleConfig,
        maxBet: null,
        maxOpenMarkets: null,
        featureFlags: {
          ...sampleConfig.featureFlags,
          enableRealtimeUpdates: false,
        },
      };

  const { dependencies, configService, auditLogService } = createDependencies();
      (configService.clearOverride as VitestMock).mockResolvedValue(resetConfig);

      const app = createApp(dependencies);
      const agent: SuperTest<SupertestRequest> = supertest(app);

      const response = await agent.delete('/api/internal/config').expect(200);

      expect(response.body.data.config).toEqual(resetConfig);
      expect(response.body.data.overridesApplied).toBe(false);
      expect(configService.clearOverride).toHaveBeenCalledWith(defaultContext.subredditId);
      expect(auditLogService.recordAction).toHaveBeenCalledWith(defaultContext.subredditId, {
        performedBy: defaultContext.userId,
        performedByUsername: defaultContext.username,
        action: 'CONFIG_UPDATE',
        marketId: null,
        payload: {
          mode: 'reset',
          overridesApplied: false,
          config: resetConfig,
        },
      });
    });
  });
});
