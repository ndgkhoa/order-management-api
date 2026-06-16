import type { FastifyReply, FastifyRequest } from 'fastify';
import { toUserPublic } from '@modules/users/users-schema.js';
import type { AuthService } from '@modules/auth/auth-service.js';
import type { LoginBody, RegisterBody } from '@modules/auth/auth-schema.js';

/**
 * HTTP glue (Controller): translates request ↔ service, maps DB entity → DTO,
 * sets status codes. No business logic here — that lives in the service.
 *
 * `req.body` is cast to the schema type: Fastify's route schema already validated
 * it at runtime, so the cast is sound. (Same style as every other controller.)
 */
export function makeAuthController(service: AuthService) {
  return {
    register: async (req: FastifyRequest, reply: FastifyReply) => {
      const { email, password } = req.body as RegisterBody;
      const user = await service.register(email, password);
      return reply.code(201).send(toUserPublic(user));
    },

    login: async (req: FastifyRequest) => {
      const { email, password } = req.body as LoginBody;
      const accessToken = await service.login(email, password);
      return { accessToken };
    },
  };
}

export type AuthController = ReturnType<typeof makeAuthController>;
