import fp from 'fastify-plugin';
import { Redis } from 'ioredis';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';

export const securityPlugin = fp(async (app) => {
  await app.register(cors, { origin: true });
  await app.register(helmet);

  const rateLimitRedis = new Redis(app.config.REDIS_URL, {
    connectionName: 'rate-limit',
    connectTimeout: 500,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    lazyConnect: false,
  });
  app.addHook('onClose', async () => {
    await rateLimitRedis.quit();
  });

  await app.register(rateLimit, {
    max: app.config.RATE_LIMIT_MAX,
    timeWindow: app.config.RATE_LIMIT_TIME_WINDOW,
    redis: rateLimitRedis,
    skipOnError: true,
  });
});
