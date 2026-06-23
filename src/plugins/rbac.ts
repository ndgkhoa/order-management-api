import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { UserRole } from '@/types/user-role.js';

/** A role-guard preHandler. Async + plain (no `this`) so it is directly callable in unit tests. */
export type RoleGuard = (request: FastifyRequest) => Promise<void>;

/**
 * Factory for a role-guard preHandler. Kept separate from the plugin so it is unit
 * testable without a running Fastify app (DI of httpErrors mirrors the service layer).
 * Reads the role from the VERIFIED JWT claim (`request.user.role`) — so `authenticate`
 * must run before this guard on the route. Async-throw style matches the `authenticate`
 * decorator. Fails closed: a missing user (no/invalid token) → 403.
 */
export function makeRequireRole(httpErrors: FastifyInstance['httpErrors']) {
  return (role: UserRole): RoleGuard => {
    // Returns a rejected promise (not a sync throw) so Fastify routes it to the error
    // handler and unit tests can assert on `.rejects`. No `await` needed → not `async`.
    return (request) =>
      request.user?.role === role
        ? Promise.resolve()
        : Promise.reject(httpErrors.forbidden('insufficient role'));
  };
}

/**
 * Registers `fastify.requireRole(role)` → a preHandler that 403s unless the
 * authenticated user carries the required role. Use after `authenticate`:
 *   { preHandler: [app.authenticate, app.requireRole(UserRoles.Admin)] }
 */
export const rbacPlugin = fp((app) => {
  app.decorate('requireRole', makeRequireRole(app.httpErrors));
  return Promise.resolve();
});
