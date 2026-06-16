import type { FastifyInstance } from 'fastify';
import type { UsersRepository } from '@modules/users/users-repository.js';

interface UsersServiceDeps {
  usersRepo: UsersRepository;
  httpErrors: FastifyInstance['httpErrors'];
}

/** User business logic. Thin today, but keeps HTTP and data access separated. */
export function makeUsersService({ usersRepo, httpErrors }: UsersServiceDeps) {
  return {
    async getById(id: string) {
      const user = await usersRepo.findById(id);
      if (!user) {
        throw httpErrors.notFound('user not found');
      }
      return user;
    },
  };
}

export type UsersService = ReturnType<typeof makeUsersService>;
