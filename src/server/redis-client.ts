import { redis } from '@devvit/web/server';
import type { RedisClient } from '@devvit/redis';

export const redisClient = redis as unknown as RedisClient;
