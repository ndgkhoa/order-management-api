import { Redis } from 'ioredis';

/**
 * Factory for an ioredis client. Both the API (via the redis plugin) and standalone
 * workers build their own client from this — separate processes shouldn't share a
 * connection. `maxRetriesPerRequest: null` lets commands wait through reconnects
 * instead of failing fast, matching the at-least-once nature of the saga.
 */
export function createRedisClient(url: string): Redis {
  return new Redis(url, { maxRetriesPerRequest: null });
}
