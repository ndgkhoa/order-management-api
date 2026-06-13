import fp from 'fastify-plugin';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';

/**
 * Generates an OpenAPI spec from route (TypeBox) schemas and serves Swagger UI
 * at /docs. Because TypeBox schemas are plain JSON Schema, no transform is needed.
 */
export const swaggerPlugin = fp(async (app) => {
  await app.register(swagger, {
    openapi: {
      info: {
        title: 'fastify-drizzle API',
        description: 'Register/login + async order email via Transactional Outbox → RabbitMQ.',
        version: '0.1.0',
      },
    },
  });
  await app.register(swaggerUi, { routePrefix: '/docs' });
});
