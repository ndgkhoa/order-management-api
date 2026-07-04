import argon2 from 'argon2';
import type { FastifyInstance } from 'fastify';
import type { UserRole } from '@/domain/user-role.js';
import type { UsersRepository } from '@modules/users/users-repository.js';

interface AuthServiceDeps {
  usersRepo: UsersRepository;
  signToken: (payload: { sub: string; email: string; roles: UserRole[] }) => string;
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
      // `roles` is a plain text[] column; its values are constrained to `UserRole` on the write
      // path (registration defaults to [customer]; promotion sets UserRole values), so the stored
      // strings are always valid roles here.
      return signToken({ sub: user.id, email: user.email, roles: user.roles as UserRole[] });
    },
  };
}

export type AuthService = ReturnType<typeof makeAuthService>;
