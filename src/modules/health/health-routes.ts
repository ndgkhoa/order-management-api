import type { FastifyInstance } from 'fastify';
import { Type } from '@sinclair/typebox';
import { sql } from 'drizzle-orm';
import { isMqHealthy } from '@infra/mq/connection.js';

/**
 * Liveness vs readiness probes (for Docker/K8s).
 * - /health: process is up (no dependency checks) → always 200.
 * - /ready: dependencies reachable. DB is checked with `SELECT 1`;
 *   the RabbitMQ check is stubbed true until phase 07 wires it.
 */
export function healthRoutes(app: FastifyInstance): void {
  const publicProbe = { tags: ['health'], security: [] };

  app.get(
    '/health',
    { schema: { ...publicProbe, response: { 200: Type.Object({ status: Type.String() }) } } },
    () => ({ status: 'ok' }),
  );

  app.get('/ready', { schema: publicProbe }, async (_req, reply) => {
    const checks = { db: false, rabbitmq: isMqHealthy() };
    try {
      await app.db.execute(sql`SELECT 1`);
      checks.db = true;
    } catch {
      checks.db = false;
    }
    const ok = checks.db && checks.rabbitmq;
    return reply.code(ok ? 200 : 503).send({ status: ok ? 'ready' : 'unready', checks });
  });
}
