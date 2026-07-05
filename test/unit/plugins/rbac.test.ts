import { describe, it, expect } from 'vitest';
import type { FastifyRequest } from 'fastify';
import { UserRoles } from '@/types/user-role';
import { Permissions } from '@/types/permission';
import { makeRequirePermission } from '@plugins/rbac';
import { httpErrorsStub } from '@test/helpers/http-errors';

const requirePermission = makeRequirePermission(httpErrorsStub);
const productCreateGuard = requirePermission(Permissions.Product.Create);

const reqWithRoles = (roles: string[]) =>
  ({ user: { sub: 'u', email: 'e', roles } }) as unknown as FastifyRequest;

describe('requirePermission', () => {
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
