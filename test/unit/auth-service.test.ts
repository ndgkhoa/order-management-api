import { describe, it, expect } from 'vitest';
import argon2 from 'argon2';
import { makeAuthService } from '@modules/auth/auth-service.js';
import type { UsersRepository } from '@modules/users/users-repository.js';

/**
 * Pure unit test: real argon2 hashing, an in-memory users repo (a true boundary stub),
 * and minimal httpErrors. No DB/HTTP — the service's logic is exercised in isolation.
 */
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

const httpErrors = {
  conflict: (m: string) => Object.assign(new Error(m), { statusCode: 409 }),
  unauthorized: (m: string) => Object.assign(new Error(m), { statusCode: 401 }),
} as unknown as Parameters<typeof makeAuthService>[0]['httpErrors'];

const signToken = () => 'signed.jwt.token';

describe('auth-service', () => {
  it('register hashes the password with argon2 (never stores plaintext)', async () => {
    const repo = makeInMemoryUsersRepo();
    const service = makeAuthService({ usersRepo: repo, signToken, httpErrors });

    const user = await service.register('a@test.dev', 'password1234');

    expect(user.passwordHash).not.toBe('password1234');
    expect(user.passwordHash.startsWith('$argon2')).toBe(true);
    expect(await argon2.verify(user.passwordHash, 'password1234')).toBe(true);
  });

  it('register throws conflict for a duplicate email', async () => {
    const repo = makeInMemoryUsersRepo();
    const service = makeAuthService({ usersRepo: repo, signToken, httpErrors });
    await service.register('dup@test.dev', 'password1234');

    await expect(service.register('dup@test.dev', 'password1234')).rejects.toMatchObject({
      statusCode: 409,
    });
  });

  it('login returns a token for valid credentials', async () => {
    const repo = makeInMemoryUsersRepo();
    const service = makeAuthService({ usersRepo: repo, signToken, httpErrors });
    await service.register('ok@test.dev', 'password1234');

    await expect(service.login('ok@test.dev', 'password1234')).resolves.toBe('signed.jwt.token');
  });

  it('login throws unauthorized for a wrong password', async () => {
    const repo = makeInMemoryUsersRepo();
    const service = makeAuthService({ usersRepo: repo, signToken, httpErrors });
    await service.register('ok2@test.dev', 'password1234');

    await expect(service.login('ok2@test.dev', 'wrong-password')).rejects.toMatchObject({
      statusCode: 401,
    });
  });

  it('login throws unauthorized for an unknown email', async () => {
    const service = makeAuthService({ usersRepo: makeInMemoryUsersRepo(), signToken, httpErrors });

    await expect(service.login('nobody@test.dev', 'password1234')).rejects.toMatchObject({
      statusCode: 401,
    });
  });
});
