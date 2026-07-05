import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyServerOptions } from 'fastify';
import { type TypeBoxTypeProvider, TypeBoxValidatorCompiler } from '@fastify/type-provider-typebox';
import fastifySensible from '@fastify/sensible';
import { envPlugin } from '@plugins/env.js';
import { securityPlugin } from '@plugins/security.js';
import { jwtPlugin } from '@plugins/jwt.js';
import { rbacPlugin } from '@plugins/rbac.js';
import { swaggerPlugin } from '@plugins/swagger.js';
import { dbPlugin } from '@plugins/db.js';
import { redisPlugin } from '@plugins/redis.js';
import { correlationIdPlugin } from '@plugins/correlation-id.js';
import { idempotencyPlugin } from '@plugins/idempotency.js';
import { errorHandlerPlugin } from '@plugins/error-handler.js';
import { metricsPlugin } from '@plugins/metrics.js';
import { initSentry } from '@infra/telemetry/sentry.js';
import { healthRoutes } from '@modules/health/health-routes.js';
import { authRoutes } from '@modules/auth/auth-routes.js';
import { usersRoutes } from '@modules/users/users-routes.js';
import { productsRoutes } from '@modules/products/products-routes.js';
import { ordersRoutes } from '@modules/orders/orders-routes.js';
import { paymentsRoutes } from '@modules/payments/payments-routes.js';
import { shipmentsRoutes } from '@modules/shipping/shipments-routes.js';

function loggerOptions(): FastifyServerOptions['logger'] {
  const level = process.env.LOG_LEVEL ?? 'info';
  return process.env.NODE_ENV === 'production'
    ? { level }
    : { level, transport: { target: 'pino-pretty' } };
}

export async function buildApp() {
  initSentry();

  const app = Fastify({
    logger: loggerOptions(),
    requestIdHeader: 'x-request-id',
    genReqId: () => randomUUID(),
  }).withTypeProvider<TypeBoxTypeProvider>();

  app.setValidatorCompiler(TypeBoxValidatorCompiler);

  await app.register(envPlugin);
  await app.register(fastifySensible);
  await app.register(correlationIdPlugin);
  await app.register(metricsPlugin);
  await app.register(redisPlugin);
  await app.register(securityPlugin);
  await app.register(jwtPlugin);
  await app.register(rbacPlugin);
  await app.register(swaggerPlugin);
  await app.register(dbPlugin);
  await app.register(errorHandlerPlugin);
  await app.register(idempotencyPlugin);

  await app.register(healthRoutes);
  await app.register(authRoutes, { prefix: '/auth' });
  await app.register(usersRoutes, { prefix: '/users' });
  await app.register(productsRoutes, { prefix: '/products' });
  await app.register(ordersRoutes, { prefix: '/orders' });
  await app.register(paymentsRoutes);
  await app.register(shipmentsRoutes, { prefix: '/shipments' });

  return app;
}

export type AppInstance = Awaited<ReturnType<typeof buildApp>>;
