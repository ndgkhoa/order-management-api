import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import fp from 'fastify-plugin';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';

/** Version comes from package.json (both dev and the container run from the project root). */
function packageVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as {
      version?: string;
    };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/**
 * Generates an OpenAPI spec from route (TypeBox) schemas and serves Swagger UI at /docs.
 * TypeBox schemas are plain JSON Schema, so no transform is needed. A global `bearerAuth`
 * (JWT) security requirement is declared; public routes opt out with `security: []`.
 */
export const swaggerPlugin = fp(async (app) => {
  await app.register(swagger, {
    openapi: {
      info: {
        title: 'order-management-api',
        description:
          'E-commerce order backend: auth (JWT), product catalog, multi-line orders, and an ' +
          'event-driven saga (Transactional Outbox → RabbitMQ) for inventory, payment, and shipping.',
        version: packageVersion(),
      },
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
            description: 'Paste the accessToken returned by POST /auth/login.',
          },
        },
      },
      // Default: every operation requires a Bearer token. Public routes override with
      // `schema.security: []` (auth endpoints, health probes, public catalog reads).
      // Tag groups come from each route's `schema.tags`; no descriptions needed.
      security: [{ bearerAuth: [] }],
    },
  });
  await app.register(swaggerUi, { routePrefix: '/docs' });
});
