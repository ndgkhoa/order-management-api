import type { FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import { isMqHealthy } from '@infra/mq/connection.js';

/**
 * Liveness vs readiness probes (for Docker/K8s).
 * - /health: process is up (no dependency checks) → always 200.
 * - /ready: dependencies reachable. DB is checked with `SELECT 1`;
 *   the RabbitMQ check is stubbed true until phase 07 wires it.
 */
export function healthRoutes(app: FastifyInstance): void {
  app.get('/health', () => ({ status: 'ok' }));

  app.get('/ready', async (_req, reply) => {
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
