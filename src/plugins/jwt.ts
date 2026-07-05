import fp from 'fastify-plugin';
import jwt from '@fastify/jwt';

export const jwtPlugin = fp(async (app) => {
  await app.register(jwt, {
    secret: app.config.JWT_SECRET,
    sign: { expiresIn: app.config.JWT_EXPIRES_IN },
  });

  app.decorate('authenticate', async (request) => {
    try {
      await request.jwtVerify();
    } catch {
      throw app.httpErrors.unauthorized('invalid or missing token');
    }
  });

  app.decorate('optionalAuth', async (request) => {
    try {
      await request.jwtVerify();
    } catch {
      // public route: proceed anonymously, but populate req.user when a valid token is present
    }
  });
});
