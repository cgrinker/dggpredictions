import type { SubredditId, UserId } from '../../shared/types/entities.js';
import { UserDirectoryRepository } from '../repositories/user-directory.repository.js';

export class UserDirectoryService {
  private readonly repository: UserDirectoryRepository;

  constructor(repository = new UserDirectoryRepository()) {
    this.repository = repository;
  }

  async rememberUser(
    subredditId: SubredditId,
    userId: UserId | null,
    username: string | null,
  ): Promise<void> {
    if (!userId || !username) {
      return;
    }

    const normalized = username.trim();
    if (!normalized) {
      return;
    }

    await this.repository.remember(subredditId, userId, normalized);
  }

  async resolveUsernames(
    subredditId: SubredditId,
    userIds: readonly UserId[],
  ): Promise<Map<UserId, string>> {
    if (userIds.length === 0) {
      return new Map();
    }

    return this.repository.getMany(subredditId, userIds);
  }

  async resolveUsername(
    subredditId: SubredditId,
    userId: UserId,
  ): Promise<string | null> {
    return this.repository.get(subredditId, userId);
  }
}
