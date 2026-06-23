import { describe, it, expect } from 'vitest';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { UserRoles } from '@/types/user-role.js';
import { makeRequireRole } from '@plugins/rbac.js';

// Minimal httpErrors stub: forbidden() returns a throwable 403 (matches @fastify/sensible shape).
const httpErrors = {
  forbidden: (msg?: string) => Object.assign(new Error(msg ?? 'forbidden'), { statusCode: 403 }),
} as unknown as FastifyInstance['httpErrors'];

const requireRole = makeRequireRole(httpErrors);
const adminGuard = requireRole(UserRoles.Admin);

const reqWithRole = (role: string) =>
  ({ user: { sub: 'u', email: 'e', role } }) as unknown as FastifyRequest;

describe('requireRole guard', () => {
  it('resolves for a matching role', async () => {
    await expect(adminGuard(reqWithRole(UserRoles.Admin))).resolves.toBeUndefined();
  });

  it('throws 403 for a non-matching role', async () => {
    await expect(adminGuard(reqWithRole(UserRoles.Customer))).rejects.toMatchObject({
      statusCode: 403,
    });
  });

  it('throws 403 when there is no authenticated user', async () => {
    await expect(adminGuard({} as FastifyRequest)).rejects.toMatchObject({ statusCode: 403 });
  });
});
