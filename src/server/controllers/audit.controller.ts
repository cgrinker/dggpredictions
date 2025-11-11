import type { Router } from 'express';
import { z } from 'zod';
import type { AuditLogService } from '../services/audit-log.service.js';
import { requireModerator } from '../middleware/auth.js';
import { asyncHandler } from '../utils/async-handler.js';
import { ensureValid } from '../../shared/validation.js';
import { nowIso } from '../utils/time.js';

const auditQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(200).optional(),
  })
  .strict();

export interface AuditControllerDependencies {
  readonly auditLogService: AuditLogService;
}

export const registerAuditRoutes = (
  router: Router,
  dependencies: AuditControllerDependencies,
): void => {
  router.get(
    ['/internal/audit/logs', '/api/internal/audit/logs'],
    requireModerator,
    asyncHandler(async (req, res) => {
      const context = req.appContext;
      if (!context) {
        throw new Error('Request context unavailable.');
      }

      const query = ensureValid(auditQuerySchema, req.query, 'Invalid audit query parameters.');
      const actions = await dependencies.auditLogService.listRecent(
        context.subredditId,
        query.limit !== undefined ? { limit: query.limit } : undefined,
      );

      res.json({
        data: {
          actions,
          fetchedAt: nowIso(),
        },
      });
    }),
  );
};
