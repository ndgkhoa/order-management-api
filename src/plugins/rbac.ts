import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { UserRole } from '@/types/user-role.js';
import type { Permission } from '@/types/permission.js';
import { ROLE_PERMISSIONS } from '@/types/role-permissions.js';

export type PermissionGuard = (request: FastifyRequest) => Promise<void>;

export function hasPermission(
  roles: readonly UserRole[] | undefined,
  permission: Permission,
): boolean {
  return (roles ?? []).some((role) => (ROLE_PERMISSIONS[role] ?? []).includes(permission));
}

export function makeRequirePermission(httpErrors: FastifyInstance['httpErrors']) {
  return (permission: Permission): PermissionGuard => {
    return (request) =>
      hasPermission(request.user?.roles, permission)
        ? Promise.resolve()
        : Promise.reject(httpErrors.forbidden('insufficient permission'));
  };
}

export const rbacPlugin = fp((app) => {
  app.decorate('requirePermission', makeRequirePermission(app.httpErrors));
  return Promise.resolve();
});
