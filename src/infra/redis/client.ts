import { Redis } from 'ioredis';

export function makeRedisClient(url: string): Redis {
  return new Redis(url, { maxRetriesPerRequest: null });
}
