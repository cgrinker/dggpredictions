import { Router } from 'express';
import { AppConfigSchema } from '../../shared/schema/config.schema.js';
import type { ConfigService } from '../services/config.service.js';
import { ensureValid } from '../../shared/validation.js';
import { asyncHandler } from '../utils/async-handler.js';
import { requireModerator } from '../middleware/auth.js';
import { ValidationError } from '../errors.js';
import type { ApiSuccessEnvelope } from '../../shared/types/dto.js';

interface ConfigResponseBody {
  readonly config: Awaited<ReturnType<ConfigService['getConfig']>>;
  readonly overridesApplied: boolean;
}

export interface ConfigControllerDependencies {
  readonly configService: ConfigService;
}

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
  router.get(
    '/api/internal/config',
    requireModerator,
    asyncHandler(async (req, res) => {
      const context = req.appContext;
      if (!context) {
        throw new ValidationError('Request context unavailable.');
      }

      const config = await dependencies.configService.getConfig(context.subredditId);
      const overridesApplied = await dependencies.configService.hasOverride(context.subredditId);
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

      const config = await dependencies.configService.updateConfig(context.subredditId, payload);
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

      const config = await dependencies.configService.clearOverride(context.subredditId);
      res.json(buildResponse(config, false));
    }),
  );
};
