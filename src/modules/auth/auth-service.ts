import argon2 from 'argon2';
import type { FastifyInstance } from 'fastify';
import type { UserRole } from '@/types/user-role.js';
import type { UsersRepository } from '@modules/users/users-repository.js';

interface AuthServiceDeps {
  usersRepo: UsersRepository;
  signToken: (payload: { sub: string; email: string; roles: UserRole[] }) => string;
  httpErrors: FastifyInstance['httpErrors'];
}

export function makeAuthService({ usersRepo, signToken, httpErrors }: AuthServiceDeps) {
  return {
    async register(email: string, password: string) {
      if (await usersRepo.findByEmail(email)) {
        throw httpErrors.conflict('email already registered');
      }
      const passwordHash = await argon2.hash(password);
      return usersRepo.create({ email, passwordHash });
    },

    async login(email: string, password: string): Promise<string> {
      const user = await usersRepo.findByEmail(email);
      if (!user || !(await argon2.verify(user.passwordHash, password))) {
        throw httpErrors.unauthorized('invalid email or password');
      }
      return signToken({ sub: user.id, email: user.email, roles: user.roles as UserRole[] });
    },
  };
}

export type AuthService = ReturnType<typeof makeAuthService>;
