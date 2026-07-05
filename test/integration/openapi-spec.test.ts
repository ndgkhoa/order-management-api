import { describe, it, expect, beforeAll } from 'vitest';
import type { AppInstance } from '@/app';
import { buildTestApp } from '@test/helpers/build-test-app';

describe('OpenAPI spec (/docs)', () => {
  let spec: {
    info: { version: string; description: string };
    components?: { securitySchemes?: Record<string, unknown> };
    security?: unknown[];
    paths: Record<string, Record<string, { security?: unknown[]; tags?: string[] }>>;
  };
  beforeAll(async () => {
    const app: AppInstance = await buildTestApp();
    spec = app.swagger() as typeof spec;
  });

  it('declares a bearerAuth (JWT) security scheme + global requirement', () => {
    expect(spec.components?.securitySchemes?.bearerAuth).toMatchObject({
      type: 'http',
      scheme: 'bearer',
    });
    expect(spec.security).toEqual([{ bearerAuth: [] }]);
  });

  it('reads the version from package.json (not a stale hardcode)', () => {
    expect(spec.info.version).not.toBe('0.1.0');
    expect(spec.info.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('exposes the catalog + order-detail paths', () => {
    for (const p of ['/products/', '/products/{id}', '/orders/', '/orders/{id}', '/users/me']) {
      expect(Object.keys(spec.paths)).toContain(p);
    }
  });

  it('marks public routes with security: [] and protected routes without an override', () => {
    expect(spec.paths['/auth/login']!.post!.security).toEqual([]);
    expect(spec.paths['/products/']!.get!.security).toEqual([]);
    expect(spec.paths['/orders/']!.post!.security).toBeUndefined();
  });

  it('tags every business route for grouping', () => {
    expect(spec.paths['/orders/']!.post!.tags).toContain('orders');
    expect(spec.paths['/products/']!.post!.tags).toContain('products');
    expect(spec.paths['/auth/login']!.post!.tags).toContain('auth');
  });
});
