import { describe, it, expect } from 'vitest';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { makeRequireRole } from '@plugins/rbac.js';

// Minimal httpErrors stub: forbidden() returns a throwable 403 (matches @fastify/sensible shape).
const httpErrors = {
  forbidden: (msg?: string) => Object.assign(new Error(msg ?? 'forbidden'), { statusCode: 403 }),
} as unknown as FastifyInstance['httpErrors'];

const requireRole = makeRequireRole(httpErrors);
const adminGuard = requireRole('admin');

function run(role: string): void {
  const request = { user: { sub: 'u', email: 'e', role } } as unknown as FastifyRequest;
  adminGuard(request, {} as FastifyReply, () => undefined);
}

describe('requireRole guard', () => {
  it('passes through (calls done) for a matching role', () => {
    let called = false;
    const request = { user: { sub: 'u', email: 'e', role: 'admin' } } as unknown as FastifyRequest;
    adminGuard(request, {} as FastifyReply, () => {
      called = true;
    });
    expect(called).toBe(true);
  });

  it('throws 403 for a non-matching role', () => {
    expect(() => run('customer')).toThrowError(/insufficient role/);
  });

  it('throws 403 when there is no authenticated user', () => {
    const request = {} as FastifyRequest;
    expect(() => adminGuard(request, {} as FastifyReply, () => undefined)).toThrow();
  });
});
