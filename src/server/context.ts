import { context as devvitContext, reddit } from '@devvit/web/server';
import type { SubredditId, UserId } from '../shared/types/entities.js';
import type { AppConfig } from '../shared/types/config.js';

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
  const contextAny = devvitContext as Partial<{ isModerator: boolean }>;
  const username = (await reddit.getCurrentUsername()) ?? null;
  const isModerator = Boolean(contextAny.isModerator);
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
