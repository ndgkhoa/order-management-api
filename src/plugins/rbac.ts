import fp from 'fastify-plugin';
import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  HookHandlerDoneFunction,
} from 'fastify';

/** A role-guard preHandler. Plain (no `this`) so it is directly callable in unit tests. */
export type RoleGuard = (
  request: FastifyRequest,
  reply: FastifyReply,
  done: HookHandlerDoneFunction,
) => void;

/**
 * Factory for a role-guard preHandler. Kept separate from the plugin so it is unit
 * testable without a running Fastify app (DI of httpErrors mirrors the service layer).
 * Reads the role from the VERIFIED JWT claim (`request.user.role`) — so `authenticate`
 * must run before this guard on the route.
 */
export function makeRequireRole(httpErrors: FastifyInstance['httpErrors']) {
  return (role: string): RoleGuard => {
    return (request, _reply, done) => {
      if (request.user?.role !== role) {
        throw httpErrors.forbidden('insufficient role');
      }
      done();
    };
  };
}

/**
 * Registers `fastify.requireRole(role)` → a preHandler that 403s unless the
 * authenticated user carries the required role. Use after `authenticate`:
 *   { preHandler: [app.authenticate, app.requireRole('admin')] }
 */
export const rbacPlugin = fp((app) => {
  app.decorate('requireRole', makeRequireRole(app.httpErrors));
  return Promise.resolve();
});
