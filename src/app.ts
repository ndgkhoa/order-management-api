import Fastify, { type FastifyInstance } from 'fastify';

/**
 * Builds and returns a configured Fastify instance WITHOUT listening,
 * so `app.inject()` tests can reuse it (see phase 09).
 *
 * STUB: fleshed out in phase 04 (TypeBox provider, env/security/jwt/swagger
 * plugins, correlation id, RFC 7807 error handler, /health + /ready).
 */
export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: true });

  app.get('/health', () => ({ status: 'ok' }));

  return app;
}
