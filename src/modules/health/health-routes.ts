import type { FastifyInstance } from 'fastify';
import { Type } from '@sinclair/typebox';
import { sql } from 'drizzle-orm';
import { isMqHealthy } from '@infra/mq/connection.js';

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
