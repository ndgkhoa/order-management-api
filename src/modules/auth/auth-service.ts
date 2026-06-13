import argon2 from 'argon2';
import type { FastifyInstance } from 'fastify';
import type { UsersRepository } from '@modules/users/users-repository.js';

interface AuthServiceDeps {
  usersRepo: UsersRepository;
  signToken: (payload: { sub: string; email: string }) => string;
  httpErrors: FastifyInstance['httpErrors'];
}

/**
 * Auth business logic (argon2id hashing + JWT issuance). Dependencies are injected
 * via the factory so the service is unit-testable without Fastify/HTTP.
 */
export function makeAuthService({ usersRepo, signToken, httpErrors }: AuthServiceDeps) {
  return {
    async register(email: string, password: string) {
      if (await usersRepo.findByEmail(email)) {
        throw httpErrors.conflict('email already registered');
      }
      const passwordHash = await argon2.hash(password); // argon2id, memory-hard
      return usersRepo.create({ email, passwordHash });
    },

    async login(email: string, password: string): Promise<string> {
      const user = await usersRepo.findByEmail(email);
      // generic message avoids user enumeration
      if (!user || !(await argon2.verify(user.passwordHash, password))) {
        throw httpErrors.unauthorized('invalid email or password');
      }
      return signToken({ sub: user.id, email: user.email });
    },
  };
}

export type AuthService = ReturnType<typeof makeAuthService>;
