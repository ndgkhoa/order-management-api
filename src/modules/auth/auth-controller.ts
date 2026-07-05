import type { FastifyReply, FastifyRequest } from 'fastify';
import { toUserPublic } from '@modules/users/users-schema.js';
import type { AuthService } from '@modules/auth/auth-service.js';
import type { LoginBody, RegisterBody } from '@modules/auth/auth-schema.js';

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
