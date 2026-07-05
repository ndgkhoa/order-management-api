import { describe, it, expect } from 'vitest';
import argon2 from 'argon2';
import { makeAuthService } from '@modules/auth/auth-service';
import type { UsersRepository } from '@modules/users/users-repository';
import { httpErrorsStub } from '@test/helpers/http-errors';

type UserRow = { id: string; email: string; passwordHash: string; createdAt: Date };

function makeInMemoryUsersRepo(seed: UserRow[] = []): UsersRepository {
  const rows = [...seed];
  return {
    findByEmail: (email) => Promise.resolve(rows.find((r) => r.email === email)),
    findById: (id) => Promise.resolve(rows.find((r) => r.id === id)),
    create: ({ email, passwordHash }) => {
      const row: UserRow = { id: crypto.randomUUID(), email, passwordHash, createdAt: new Date() };
      rows.push(row);
      return Promise.resolve(row);
    },
  } as UsersRepository;
}

const signToken = () => 'signed.jwt.token';

function makeSUT(seed: UserRow[] = []) {
  return makeAuthService({
    usersRepo: makeInMemoryUsersRepo(seed),
    signToken,
    httpErrors: httpErrorsStub,
  });
}

describe('authService', () => {
  describe('register', () => {
    it('hashes the password with argon2 (never stores plaintext)', async () => {
      const service = makeSUT();

      const user = await service.register('a@test.dev', 'password1234');

      expect(user.passwordHash).not.toBe('password1234');
      expect(user.passwordHash.startsWith('$argon2')).toBe(true);
      expect(await argon2.verify(user.passwordHash, 'password1234')).toBe(true);
    });

    it('throws conflict for a duplicate email', async () => {
      const service = makeSUT();
      await service.register('dup@test.dev', 'password1234');

      await expect(service.register('dup@test.dev', 'password1234')).rejects.toMatchObject({
        statusCode: 409,
      });
    });
  });

  describe('login', () => {
    it('returns a token for valid credentials', async () => {
      const service = makeSUT();
      await service.register('ok@test.dev', 'password1234');

      await expect(service.login('ok@test.dev', 'password1234')).resolves.toBe('signed.jwt.token');
    });

    it('throws unauthorized for a wrong password', async () => {
      const service = makeSUT();
      await service.register('ok2@test.dev', 'password1234');

      await expect(service.login('ok2@test.dev', 'wrong-password')).rejects.toMatchObject({
        statusCode: 401,
      });
    });

    it('throws unauthorized for an unknown email', async () => {
      const service = makeSUT();

      await expect(service.login('nobody@test.dev', 'password1234')).rejects.toMatchObject({
        statusCode: 401,
      });
    });
  });
});
