import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { makeUsersRepository } from '@modules/users/users-repository';
import { makeUsersService } from '@modules/users/users-service';
import { makeUsersController } from '@modules/users/users-controller';
import { UserPublic } from '@modules/users/users-schema';
import { errorResponses } from '@infra/http/error-responses';

export const usersRoutes: FastifyPluginAsyncTypebox = (app) => {
  const usersRepo = makeUsersRepository(app.db);
  const service = makeUsersService({ usersRepo, httpErrors: app.httpErrors });
  const controller = makeUsersController(service);

  app.get(
    '/me',
    {
      preHandler: app.authenticate,
      schema: { tags: ['users'], response: { 200: UserPublic, ...errorResponses(401, 404) } },
    },
    controller.me,
  );

  return Promise.resolve();
};
