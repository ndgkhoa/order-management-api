import fp from 'fastify-plugin';
import { makeRedisClient } from '@infra/redis/client.js';

export const redisPlugin = fp(async (app) => {
  const redis = makeRedisClient(app.config.REDIS_URL);
  await redis.ping();
  app.decorate('redis', redis);
  app.addHook('onClose', async () => {
    await redis.quit();
  });
});
