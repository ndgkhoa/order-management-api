import type { FastifyInstance } from 'fastify';
import { Type } from '@sinclair/typebox';
import { sql } from 'drizzle-orm';
import { isMqHealthy } from '@infra/mq/connection';
import { packageInfo } from '@config/package-info';

export function healthRoutes(app: FastifyInstance): void {
  const publicProbe = { tags: ['health'], security: [] };
  const pkg = packageInfo();

  app.get(
    '/',
    {
      schema: {
        ...publicProbe,
        response: { 200: Type.Object({ name: Type.String(), version: Type.String() }) },
      },
    },
    () => ({ name: pkg.name, version: pkg.version }),
  );

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
