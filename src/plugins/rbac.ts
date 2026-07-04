import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Permission } from '@/domain/permission.js';
import { hasPermission } from '@/domain/role-permissions.js';

/** A permission-guard preHandler. Async + plain (no `this`) so it is directly callable in unit tests. */
export type PermissionGuard = (request: FastifyRequest) => Promise<void>;

/**
 * Factory for a permission-guard preHandler. Kept separate from the plugin so it is unit
 * testable without a running Fastify app (DI of httpErrors mirrors the service layer). Reads the
 * roles from the VERIFIED JWT claim (`request.user.roles`) and resolves them to permissions — so
 * `authenticate` must run before this guard on the route. Fails closed: a missing user (no/invalid
 * token) has no roles → no permissions → 403.
 */
export function makeRequirePermission(httpErrors: FastifyInstance['httpErrors']) {
  return (permission: Permission): PermissionGuard => {
    // Returns a rejected promise (not a sync throw) so Fastify routes it to the error
    // handler and unit tests can assert on `.rejects`. No `await` needed → not `async`.
    return (request) =>
      hasPermission(request.user?.roles, permission)
        ? Promise.resolve()
        : Promise.reject(httpErrors.forbidden('insufficient permission'));
  };
}

/**
 * Registers `fastify.requirePermission(permission)` → a preHandler that 403s unless the
 * authenticated user's roles grant the permission. Use after `authenticate`:
 *   { preHandler: [app.authenticate, app.requirePermission(Permissions.Product.Create)] }
 */
export const rbacPlugin = fp((app) => {
  app.decorate('requirePermission', makeRequirePermission(app.httpErrors));
  return Promise.resolve();
});
