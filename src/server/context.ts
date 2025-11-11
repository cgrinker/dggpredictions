import { context as devvitContext, reddit } from '@devvit/web/server';
import { Header } from '@devvit/shared-types/Header.js';
import type { SubredditId, UserId } from '../shared/types/entities.js';
import type { AppConfig } from '../shared/types/config.js';
import { logger } from './logging.js';

type MetadataRecord = Record<string, { readonly values: readonly string[] } | undefined>;

type ModeratorHints = {
  readonly metadata: MetadataRecord | undefined;
  readonly subredditId: SubredditId;
  readonly subredditName: string;
};

const hasModeratorSignal = ({ metadata, subredditId, subredditName }: ModeratorHints): boolean => {
  const idStr = subredditId as unknown as string;
  const nameStr = subredditName;
  const values = metadata?.[Header.ModPermissions]?.values ?? [];
  if (!values || values.length === 0) {
    return false;
  }

  return values.some((value) => {
    if (!value) {
      return false;
    }

    const normalized = value.toLowerCase();
    if (normalized === 'true' || normalized === '1') {
      return true;
    }

    try {
      const parsed = JSON.parse(value) as unknown;
      if (Array.isArray(parsed)) {
        return parsed.length > 0;
      }

      if (parsed && typeof parsed === 'object') {
        const record = parsed as Record<string, unknown>;
        const candidates = [
          idStr,
          idStr.toLowerCase(),
          nameStr,
          nameStr.toLowerCase(),
        ];

        for (const key of candidates) {
          if (!(key in record)) {
            continue;
          }

          const entry = record[key];
          if (Array.isArray(entry)) {
            return entry.length > 0;
          }
          if (typeof entry === 'string') {
            return entry.length > 0;
          }
          if (entry && typeof entry === 'object') {
            return Object.keys(entry as Record<string, unknown>).length > 0;
          }
          if (entry === true) {
            return true;
          }
        }
      }
    } catch {
      const lower = value.toLowerCase();
      if (value.includes(idStr) || lower.includes(nameStr.toLowerCase())) {
        return true;
      }
    }

    return false;
  });
};

export interface RequestContext {
  readonly subredditId: SubredditId;
  readonly subredditName: string;
  readonly userId: UserId | null;
  readonly username: string | null;
  readonly isModerator: boolean;
  readonly config: AppConfig | null;
}

export const buildRequestContext = async (
  configProvider: (subredditId: SubredditId) => Promise<AppConfig | null>,
) => {
  const subredditId = devvitContext.subredditId as SubredditId;
  const subredditName = devvitContext.subredditName ?? 'unknown-subreddit';
  const userId = (devvitContext.userId ?? null) as UserId | null;
  const contextAny = devvitContext as Partial<{ isModerator: boolean; metadata: MetadataRecord }>;
  const username = (await reddit.getCurrentUsername()) ?? null;

  let isModerator = Boolean(contextAny.isModerator);

  if (!isModerator) {
    isModerator = hasModeratorSignal({
      metadata: contextAny.metadata,
      subredditId,
      subredditName,
    });
  }

  if (!isModerator && userId) {
    try {
      const currentUser = await reddit.getCurrentUser();
      if (currentUser) {
        const permissions = await currentUser.getModPermissionsForSubreddit(subredditName);
        if (permissions.length > 0) {
          isModerator = true;
        }
      }
    } catch (error) {
      logger.warn('failed to verify moderator permissions via reddit API', {
        subredditId,
        subredditName,
        message: error instanceof Error ? error.message : 'unknown error',
      });
    }
  }

  const config = await configProvider(subredditId);

  const context: RequestContext = {
    subredditId,
    subredditName,
    userId,
    username,
    isModerator,
    config,
  };

  return context;
};
