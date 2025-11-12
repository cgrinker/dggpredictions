import { Router } from 'express';
import { AppConfigSchema } from '../../shared/schema/config.schema.js';
import type { ConfigService } from '../services/config.service.js';
import type { AuditLogService } from '../services/audit-log.service.js';
import { ensureValid } from '../../shared/validation.js';
import { asyncHandler } from '../utils/async-handler.js';
import { requireModerator } from '../middleware/auth.js';
import { ValidationError } from '../errors.js';
import type { ApiSuccessEnvelope } from '../../shared/types/dto.js';
import type { UserId } from '../../shared/types/entities.js';
import type { RequestContext } from '../context.js';

interface ConfigResponseBody {
  readonly config: Awaited<ReturnType<ConfigService['getConfig']>>;
  readonly overridesApplied: boolean;
}

export interface ConfigControllerDependencies {
  readonly configService: ConfigService;
  readonly auditLogService: AuditLogService;
}

const SYSTEM_CONFIG_ACTOR_ID = 'system:config' as UserId;
const SYSTEM_CONFIG_ACTOR_USERNAME = 'config-service';

const resolveConfigActor = (
  context: RequestContext,
): { readonly id: UserId; readonly username: string } => {
  if (context.userId) {
    return {
      id: context.userId,
      username: context.username ?? 'unknown-moderator',
    };
  }

  return {
    id: SYSTEM_CONFIG_ACTOR_ID,
    username: SYSTEM_CONFIG_ACTOR_USERNAME,
  };
};

const buildResponse = (config: Awaited<ReturnType<ConfigService['getConfig']>>, overridesApplied: boolean) =>
  ({
    data: {
      config,
      overridesApplied,
    },
  }) satisfies ApiSuccessEnvelope<ConfigResponseBody>;

export const registerConfigRoutes = (
  router: Router,
  dependencies: ConfigControllerDependencies,
): void => {
  const { configService, auditLogService } = dependencies;

  router.get(
    '/api/internal/config',
    requireModerator,
    asyncHandler(async (req, res) => {
      const context = req.appContext;
      if (!context) {
        throw new ValidationError('Request context unavailable.');
      }

      const config = await configService.getConfig(context.subredditId);
      const overridesApplied = await configService.hasOverride(context.subredditId);
      res.json(buildResponse(config, overridesApplied));
    }),
  );

  router.post(
    '/api/internal/config',
    requireModerator,
    asyncHandler(async (req, res) => {
      const context = req.appContext;
      if (!context) {
        throw new ValidationError('Request context unavailable.');
      }

      const payload = ensureValid(
        AppConfigSchema,
        typeof req.body === 'object' && req.body !== null ? req.body : {},
        'Invalid configuration payload.',
      );

      const config = await configService.updateConfig(context.subredditId, payload);

      const actor = resolveConfigActor(context);
      await auditLogService.recordAction(context.subredditId, {
        performedBy: actor.id,
        performedByUsername: actor.username,
        action: 'CONFIG_UPDATE',
        marketId: null,
        payload: {
          mode: 'update',
          overridesApplied: true,
          config,
        },
      });

      res.json(buildResponse(config, true));
    }),
  );

  router.delete(
    '/api/internal/config',
    requireModerator,
    asyncHandler(async (req, res) => {
      const context = req.appContext;
      if (!context) {
        throw new ValidationError('Request context unavailable.');
      }

      const config = await configService.clearOverride(context.subredditId);

      const actor = resolveConfigActor(context);
      await auditLogService.recordAction(context.subredditId, {
        performedBy: actor.id,
        performedByUsername: actor.username,
        action: 'CONFIG_UPDATE',
        marketId: null,
        payload: {
          mode: 'reset',
          overridesApplied: false,
          config,
        },
      });

      res.json(buildResponse(config, false));
    }),
  );
};
