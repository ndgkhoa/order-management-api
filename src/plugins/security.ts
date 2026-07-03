import fp from 'fastify-plugin';
import { Redis } from 'ioredis';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';

/**
 * CORS + secure headers (helmet) + Redis-backed rate limiting. The Redis store makes the
 * request counter shared across instances (an in-memory store would let each replica grant
 * its own budget).
 *
 * Rate limiting uses a DEDICATED, fail-fast Redis connection (bounded connect timeout, no
 * offline queue) rather than the shared `app.redis`: the shared client waits through
 * reconnects (`maxRetriesPerRequest: null`), which on the app-wide onRequest hot path would
 * hang EVERY route (incl. health probes) during a Redis blip. With `skipOnError: true` a
 * store error instead degrades OPEN — rate limiting is DoS protection, not correctness, so
 * a brief unlimited window beats blocking all traffic.
 */
export const securityPlugin = fp(async (app) => {
  await app.register(cors, { origin: true });
  await app.register(helmet);

  const rateLimitRedis = new Redis(app.config.REDIS_URL, {
    connectionName: 'rate-limit',
    connectTimeout: 500,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false, // surface errors fast so skipOnError can fail open
    lazyConnect: false,
  });
  app.addHook('onClose', async () => {
    await rateLimitRedis.quit();
  });

  await app.register(rateLimit, {
    max: app.config.RATE_LIMIT_MAX,
    timeWindow: app.config.RATE_LIMIT_TIME_WINDOW,
    redis: rateLimitRedis,
    skipOnError: true, // Redis unreachable → allow the request rather than block everything
  });
});
