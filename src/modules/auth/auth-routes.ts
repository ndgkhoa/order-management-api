import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { makeUsersRepository } from '@modules/users/users-repository';
import { UserPublic } from '@modules/users/users-schema';
import { makeAuthService } from '@modules/auth/auth-service';
import { makeAuthController } from '@modules/auth/auth-controller';
import { LoginBody, RegisterBody, TokenResponse } from '@modules/auth/auth-schema';
import { errorResponses } from '@infra/http/error-responses';

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
    {
      schema: {
        tags: ['auth'],
        security: [],
        body: RegisterBody,
        response: { 201: UserPublic, ...errorResponses(400, 409) },
      },
    },
    controller.register,
  );

  app.post(
    '/login',
    {
      schema: {
        tags: ['auth'],
        security: [],
        body: LoginBody,
        response: { 200: TokenResponse, ...errorResponses(400, 401) },
      },
    },
    controller.login,
  );

  return Promise.resolve();
};
