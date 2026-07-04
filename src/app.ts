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

/** Pretty logs in dev, structured JSON in production. */
function loggerOptions(): FastifyServerOptions['logger'] {
  const level = process.env.LOG_LEVEL ?? 'info';
  return process.env.NODE_ENV === 'production'
    ? { level }
    : { level, transport: { target: 'pino-pretty' } };
}

/**
 * Builds a configured Fastify instance WITHOUT listening, so `app.inject()` tests
 * can reuse it. `server.ts` is the only place that calls `listen`.
 *
 * Plugin order matters: env first (provides app.config used by jwt), then
 * security/jwt/swagger/db, then the error handler, then routes.
 */
export async function buildApp() {
  initSentry(); // no-op without SENTRY_DSN

  const app = Fastify({
    logger: loggerOptions(),
    requestIdHeader: 'x-request-id',
    genReqId: () => randomUUID(),
  }).withTypeProvider<TypeBoxTypeProvider>();

  app.setValidatorCompiler(TypeBoxValidatorCompiler);

  await app.register(envPlugin); // -> app.config
  await app.register(fastifySensible); // httpErrors helpers
  await app.register(correlationIdPlugin);
  await app.register(metricsPlugin); // /metrics for Prometheus
  await app.register(redisPlugin); // -> app.redis (before security: rate-limit store)
  await app.register(securityPlugin); // Redis-backed rate limit (needs app.redis)
  await app.register(jwtPlugin); // -> app.authenticate
  await app.register(rbacPlugin); // -> app.requirePermission (needs app.httpErrors from sensible)
  await app.register(swaggerPlugin); // /docs
  await app.register(dbPlugin); // -> app.db
  await app.register(errorHandlerPlugin); // RFC 7807
  await app.register(idempotencyPlugin); // -> app.idempotency (needs redis + httpErrors)

  await app.register(healthRoutes);
  await app.register(authRoutes, { prefix: '/auth' });
  await app.register(usersRoutes, { prefix: '/users' });
  await app.register(productsRoutes, { prefix: '/products' });
  await app.register(ordersRoutes, { prefix: '/orders' });
  await app.register(paymentsRoutes); // /webhooks/payment + /mock-payments/* (own raw-body parser)
  await app.register(shipmentsRoutes, { prefix: '/shipments' }); // admin manual advance

  return app;
}

export type AppInstance = Awaited<ReturnType<typeof buildApp>>;
