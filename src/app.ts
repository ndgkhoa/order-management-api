import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyServerOptions } from 'fastify';
import { type TypeBoxTypeProvider, TypeBoxValidatorCompiler } from '@fastify/type-provider-typebox';
import fastifySensible from '@fastify/sensible';
import { envPlugin } from '@plugins/env.js';
import { securityPlugin } from '@plugins/security.js';
import { jwtPlugin } from '@plugins/jwt.js';
import { swaggerPlugin } from '@plugins/swagger.js';
import { dbPlugin } from '@plugins/db.js';
import { correlationIdPlugin } from '@plugins/correlation-id.js';
import { errorHandlerPlugin } from '@plugins/error-handler.js';
import { healthRoutes } from '@modules/health/health-routes.js';
import { authRoutes } from '@modules/auth/auth-routes.js';
import { usersRoutes } from '@modules/users/users-routes.js';
import { ordersRoutes } from '@modules/orders/orders-routes.js';

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
  const app = Fastify({
    logger: loggerOptions(),
    requestIdHeader: 'x-request-id',
    genReqId: () => randomUUID(),
  }).withTypeProvider<TypeBoxTypeProvider>();

  app.setValidatorCompiler(TypeBoxValidatorCompiler);

  await app.register(envPlugin); // -> app.config
  await app.register(fastifySensible); // httpErrors helpers
  await app.register(correlationIdPlugin);
  await app.register(securityPlugin);
  await app.register(jwtPlugin); // -> app.authenticate
  await app.register(swaggerPlugin); // /docs
  await app.register(dbPlugin); // -> app.db
  await app.register(errorHandlerPlugin); // RFC 7807

  await app.register(healthRoutes);
  await app.register(authRoutes, { prefix: '/auth' });
  await app.register(usersRoutes, { prefix: '/users' });
  await app.register(ordersRoutes, { prefix: '/orders' });

  return app;
}

export type AppInstance = Awaited<ReturnType<typeof buildApp>>;
