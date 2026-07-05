import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyServerOptions } from 'fastify';
import { type TypeBoxTypeProvider, TypeBoxValidatorCompiler } from '@fastify/type-provider-typebox';
import fastifySensible from '@fastify/sensible';
import { envPlugin } from '@plugins/env';
import { securityPlugin } from '@plugins/security';
import { jwtPlugin } from '@plugins/jwt';
import { rbacPlugin } from '@plugins/rbac';
import { swaggerPlugin } from '@plugins/swagger';
import { dbPlugin } from '@plugins/db';
import { redisPlugin } from '@plugins/redis';
import { correlationIdPlugin } from '@plugins/correlation-id';
import { idempotencyPlugin } from '@plugins/idempotency';
import { errorHandlerPlugin } from '@plugins/error-handler';
import { metricsPlugin } from '@plugins/metrics';
import { initSentry } from '@infra/telemetry/sentry';
import { healthRoutes } from '@modules/health/health-routes';
import { authRoutes } from '@modules/auth/auth-routes';
import { usersRoutes } from '@modules/users/users-routes';
import { productsRoutes } from '@modules/products/products-routes';
import { ordersRoutes } from '@modules/orders/orders-routes';
import { paymentsRoutes } from '@modules/payments/payments-routes';
import { shipmentsRoutes } from '@modules/shipping/shipments-routes';

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
