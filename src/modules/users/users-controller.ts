import type { FastifyRequest } from 'fastify';
import { toUserPublic } from '@modules/users/users-schema.js';
import type { UsersService } from '@modules/users/users-service.js';

export function makeUsersController(service: UsersService) {
  return {
    me: async (req: FastifyRequest) => {
      const user = await service.getById(req.user.sub);
      return toUserPublic(user);
    },
  };
}

export type UsersController = ReturnType<typeof makeUsersController>;
