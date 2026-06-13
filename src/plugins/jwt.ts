import fp from 'fastify-plugin';
import jwt from '@fastify/jwt';

/**
 * Registers @fastify/jwt (secret from validated config) and an `authenticate`
 * preHandler decorator. Routes use `preHandler: app.authenticate` to require a
 * valid Bearer token; jwtVerify throws on failure → 401 Problem via error handler.
 * Registered AFTER envPlugin so app.config is available.
 */
export const jwtPlugin = fp(async (app) => {
  await app.register(jwt, {
    secret: app.config.JWT_SECRET,
    sign: { expiresIn: app.config.JWT_EXPIRES_IN },
  });

  app.decorate('authenticate', async (request) => {
    await request.jwtVerify();
  });
});
