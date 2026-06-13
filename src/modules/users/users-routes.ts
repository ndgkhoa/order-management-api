import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { makeUsersRepository } from './users-repository.js';
import { makeUsersService } from './users-service.js';
import { makeUsersController } from './users-controller.js';
import { UserPublic } from './users-schema.js';

/** /users routes. GET /me is protected by the `authenticate` preHandler (JWT). */
export const usersRoutes: FastifyPluginAsyncTypebox = (app) => {
  const usersRepo = makeUsersRepository(app.db);
  const service = makeUsersService({ usersRepo, httpErrors: app.httpErrors });
  const controller = makeUsersController(service);

  app.get(
    '/me',
    { preHandler: app.authenticate, schema: { response: { 200: UserPublic } } },
    controller.me,
  );

  return Promise.resolve();
};
