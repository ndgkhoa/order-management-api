import fp from 'fastify-plugin';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';

/** CORS + secure headers (helmet) + in-memory rate limiting. */
export const securityPlugin = fp(async (app) => {
  await app.register(cors, { origin: true });
  await app.register(helmet);
  await app.register(rateLimit, { max: 100, timeWindow: '1 minute' });
});
