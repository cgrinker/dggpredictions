import type { AppConfig, ConfigSnapshot } from '../../shared/types/config.js';
import type { SubredditId } from '../../shared/types/entities.js';
import { AppConfigSchema, ConfigSnapshotSchema } from '../../shared/schema/config.schema.js';
import { configKeys } from '../utils/redis-keys.js';
import { redisClient } from '../redis-client.js';
import { ensureValid } from '../../shared/validation.js';
import { logger } from '../logging.js';

const CACHE_TTL_SECONDS = 300;

export class ConfigRepository {
  async getCached(subredditId: SubredditId): Promise<ConfigSnapshot | null> {
    const key = configKeys.cache(subredditId);
    const payload = await redisClient.get(key);
    if (!payload) {
      return null;
    }

    try {
      const parsed = JSON.parse(payload) as ConfigSnapshot;
      return ensureValid(ConfigSnapshotSchema, parsed);
    } catch (error) {
  await redisClient.del(key);
  logger.warn('Invalid config cache encountered; purging', { subredditId, error });
      return null;
    }
  }

  async cacheConfig(snapshot: ConfigSnapshot): Promise<void> {
  const key = configKeys.cache(snapshot.subredditId as SubredditId);
    const validated = ensureValid(ConfigSnapshotSchema, snapshot);
    const expiration = new Date(Date.now() + CACHE_TTL_SECONDS * 1000);
    await redisClient.set(key, JSON.stringify(validated), { expiration });
  }

  validateConfig(config: AppConfig): AppConfig {
    return ensureValid(AppConfigSchema, config);
  }
}
