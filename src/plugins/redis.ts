import fp from 'fastify-plugin';
import { makeRedisClient } from '@infra/redis/client.js';

/**
 * Exposes an ioredis client as `fastify.redis` and closes it on shutdown.
 * Pings at boot so a missing/unreachable Redis fails fast with a clear error
 * (Redis is a hard dependency: idempotency store, webhook dedup, cache, rate-limit).
 * Registered after envPlugin so `app.config.REDIS_URL` is available.
 */
export const redisPlugin = fp(async (app) => {
  const redis = makeRedisClient(app.config.REDIS_URL);
  await redis.ping(); // fail fast at boot if Redis is unreachable
  app.decorate('redis', redis);
  app.addHook('onClose', async () => {
    await redis.quit();
  });
});
