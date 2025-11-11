import type { ModeratorActionId, SubredditId } from '../../shared/types/entities.js';
import type { ModeratorActionBase } from '../../shared/types/moderation.js';
import { redisClient } from '../redis-client.js';
import { auditKeys } from '../utils/redis-keys.js';
import { deserializeModeratorAction, serializeModeratorAction } from '../utils/serializers.js';

const DEFAULT_MAX_ACTIONS = 2_000;
const DEFAULT_FETCH_LIMIT = 100;

interface RepositoryOptions {
  readonly maxActions?: number;
  readonly maxFetch?: number;
}

export class ModeratorActionRepository {
  private readonly maxActions: number;
  private readonly maxFetch: number;

  constructor(options: RepositoryOptions = {}) {
    this.maxActions = Math.max(1, options.maxActions ?? DEFAULT_MAX_ACTIONS);
    this.maxFetch = Math.max(1, Math.min(this.maxActions, options.maxFetch ?? DEFAULT_FETCH_LIMIT));
  }

  async append(action: ModeratorActionBase): Promise<void> {
    const recordKey = auditKeys.record(action.subredditId, action.id);
    const indexKey = auditKeys.list(action.subredditId);
    const score = Date.parse(action.createdAt) || Date.now();

    await redisClient.hSet(recordKey, serializeModeratorAction(action));
    await redisClient.zAdd(indexKey, { score, member: action.id });

    const total = await redisClient.zCard(indexKey);
    const overflow = total - this.maxActions;
    if (overflow > 0) {
      const stale = await redisClient.zRange(indexKey, 0, overflow - 1, { by: 'rank' });
      if (stale.length > 0) {
        await redisClient.zRemRangeByRank(indexKey, 0, overflow - 1);
        await Promise.all(
          stale.map(({ member }) =>
            redisClient.del(auditKeys.record(action.subredditId, member as ModeratorActionId)),
          ),
        );
      }
    }
  }

  async listRecent(subredditId: SubredditId, limit?: number): Promise<ModeratorActionBase[]> {
    const indexKey = auditKeys.list(subredditId);
    const rangeSize = Math.max(1, Math.min(limit ?? this.maxFetch, this.maxActions));
    const start = -rangeSize;
    const rawEntries = await redisClient.zRange(indexKey, start, -1, { by: 'rank' });
    const entries = rawEntries.reverse();

    if (entries.length === 0) {
      return [];
    }

    const actions = await Promise.all(
      entries.map(async ({ member }) => {
        const hash = await redisClient.hGetAll(
          auditKeys.record(subredditId, member as ModeratorActionId),
        );
        return deserializeModeratorAction(hash);
      }),
    );

    return actions.filter((action): action is ModeratorActionBase => action !== null);
  }
}
