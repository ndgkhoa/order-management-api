import fp from 'fastify-plugin';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { packageInfo } from '@config/package-info';

export const swaggerPlugin = fp(async (app) => {
  const pkg = packageInfo();
  await app.register(swagger, {
    openapi: {
      info: {
        title: pkg.name,
        description: 'E-commerce order backend',
        version: pkg.version,
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
      security: [{ bearerAuth: [] }],
    },
  });
  await app.register(swaggerUi, { routePrefix: '/docs' });
});
