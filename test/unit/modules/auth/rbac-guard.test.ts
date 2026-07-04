import { describe, it, expect } from 'vitest';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { UserRoles } from '@/domain/user-role.js';
import { Permissions } from '@/domain/permission.js';
import { makeRequirePermission } from '@plugins/rbac.js';

// Minimal httpErrors stub: forbidden() returns a throwable 403 (matches @fastify/sensible shape).
const httpErrors = {
  forbidden: (msg?: string) => Object.assign(new Error(msg ?? 'forbidden'), { statusCode: 403 }),
} as unknown as FastifyInstance['httpErrors'];

const requirePermission = makeRequirePermission(httpErrors);
const productCreateGuard = requirePermission(Permissions.Product.Create);

const reqWithRoles = (roles: string[]) =>
  ({ user: { sub: 'u', email: 'e', roles } }) as unknown as FastifyRequest;

describe('requirePermission guard', () => {
  it('resolves when a role grants the permission', async () => {
    await expect(productCreateGuard(reqWithRoles([UserRoles.Admin]))).resolves.toBeUndefined();
  });

  it('throws 403 when no role grants the permission', async () => {
    await expect(productCreateGuard(reqWithRoles([UserRoles.Customer]))).rejects.toMatchObject({
      statusCode: 403,
    });
  });

  it('resolves when any of several roles grants the permission', async () => {
    await expect(
      productCreateGuard(reqWithRoles([UserRoles.Customer, UserRoles.Admin])),
    ).resolves.toBeUndefined();
  });

  it('throws 403 when there is no authenticated user', async () => {
    await expect(productCreateGuard({} as FastifyRequest)).rejects.toMatchObject({
      statusCode: 403,
    });
  });
});
