import type { MarketId, SubredditId, UserId } from '../../shared/types/entities.js';
import type {
  ModeratorActionBase,
  ModeratorActionSnapshot,
  ModeratorActionType,
} from '../../shared/types/moderation.js';
import { ModeratorActionRepository } from '../repositories/moderator-action.repository.js';
import { createModeratorActionId } from '../utils/id.js';
import { nowIso } from '../utils/time.js';

interface RecordActionInput {
  readonly performedBy: UserId;
  readonly performedByUsername: string;
  readonly action: ModeratorActionType;
  readonly marketId?: MarketId | null;
  readonly targetUserId?: UserId | null;
  readonly payload?: Record<string, unknown>;
  readonly snapshot?: ModeratorActionSnapshot;
  readonly correlationId?: string | null;
}

export class AuditLogService {
  private readonly actions: ModeratorActionRepository;

  constructor(actions = new ModeratorActionRepository()) {
    this.actions = actions;
  }

  async recordAction(subredditId: SubredditId, input: RecordActionInput): Promise<ModeratorActionBase> {
    const action: ModeratorActionBase = {
      schemaVersion: 1,
      id: createModeratorActionId(),
      subredditId,
      performedBy: input.performedBy,
      performedByUsername: input.performedByUsername,
      action: input.action,
      marketId: input.marketId ?? null,
      targetUserId: input.targetUserId ?? null,
      payload: input.payload ?? {},
      createdAt: nowIso(),
      ...(input.snapshot ? { snapshot: input.snapshot } : {}),
      ...(input.correlationId ? { correlationId: input.correlationId } : {}),
    };

    await this.actions.append(action);
    return action;
  }

  async listRecent(
    subredditId: SubredditId,
    options?: { readonly limit?: number },
  ): Promise<readonly ModeratorActionBase[]> {
    const limit = options?.limit;
    return this.actions.listRecent(subredditId, limit);
  }
}
