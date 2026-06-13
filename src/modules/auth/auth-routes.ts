import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { makeUsersRepository } from '@modules/users/users-repository.js';
import { UserPublic } from '@modules/users/users-schema.js';
import { makeAuthService } from './auth-service.js';
import { makeAuthController } from './auth-controller.js';
import { LoginBody, RegisterBody, TokenResponse } from './auth-schema.js';

/**
 * /auth routes. Wires repository → service → controller (DI from app decorators).
 * TypeBox schemas drive validation, OpenAPI, and body typing.
 */
export const authRoutes: FastifyPluginAsyncTypebox = (app) => {
  const usersRepo = makeUsersRepository(app.db);
  const service = makeAuthService({
    usersRepo,
    signToken: (payload) => app.jwt.sign(payload),
    httpErrors: app.httpErrors,
  });
  const controller = makeAuthController(service);

  app.post(
    '/register',
    { schema: { body: RegisterBody, response: { 201: UserPublic } } },
    controller.register,
  );

  app.post(
    '/login',
    { schema: { body: LoginBody, response: { 200: TokenResponse } } },
    controller.login,
  );

  return Promise.resolve();
};
