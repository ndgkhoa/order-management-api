import type { FastifyReply, FastifyRequest } from 'fastify';
import { toUserPublic } from '@modules/users/users-schema.js';
import type { AuthService } from './auth-service.js';
import type { LoginBody, RegisterBody } from './auth-schema.js';

/**
 * HTTP glue (Controller): translates request ↔ service, maps DB entity → DTO,
 * sets status codes. No business logic here — that lives in the service.
 */
export function makeAuthController(service: AuthService) {
  return {
    register: async (req: FastifyRequest<{ Body: RegisterBody }>, reply: FastifyReply) => {
      const user = await service.register(req.body.email, req.body.password);
      return reply.code(201).send(toUserPublic(user));
    },

    login: async (req: FastifyRequest<{ Body: LoginBody }>) => {
      const accessToken = await service.login(req.body.email, req.body.password);
      return { accessToken };
    },
  };
}

export type AuthController = ReturnType<typeof makeAuthController>;
