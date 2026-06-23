import { describe, it, expect } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { makeProductsService } from '@modules/products/products-service.js';
import type { ProductsRepository } from '@modules/products/products-repository.js';
import type { ProductsCache } from '@modules/products/products-cache.js';

// httpErrors stub: each helper throws an Error carrying the HTTP status (matches sensible).
const httpErrors = {
  conflict: (m?: string) => Object.assign(new Error(m ?? 'conflict'), { statusCode: 409 }),
  notFound: (m?: string) => Object.assign(new Error(m ?? 'not found'), { statusCode: 404 }),
} as unknown as FastifyInstance['httpErrors'];

const noopCache = {
  invalidate: () => Promise.resolve(),
} as unknown as ProductsCache;

// Loose stub type: repo methods return drizzle query builders, not plain Promises, so
// the awaited fakes can't match the real signatures — cast through unknown.
function makeService(repo: Partial<Record<keyof ProductsRepository, unknown>>) {
  return makeProductsService({
    productsRepo: repo as unknown as ProductsRepository,
    cache: noopCache,
    httpErrors,
  });
}

describe('products service', () => {
  it('create rejects a duplicate SKU with 409', async () => {
    const service = makeService({
      findBySku: () => Promise.resolve({ id: 'x' } as never), // existing product
      create: () => Promise.reject(new Error('should not be called')),
    });
    await expect(service.create({ sku: 'DUP', name: 'n', priceCents: 100 })).rejects.toMatchObject({
      statusCode: 409,
    });
  });

  it('create inserts when the SKU is free', async () => {
    const created = { id: '1', sku: 'NEW' };
    const service = makeService({
      findBySku: () => Promise.resolve(undefined),
      create: () => Promise.resolve(created as never),
    });
    await expect(service.create({ sku: 'NEW', name: 'n', priceCents: 100 })).resolves.toBe(created);
  });

  it('update of a missing product throws 404', async () => {
    const service = makeService({ update: () => Promise.resolve(undefined) });
    await expect(service.update('missing', { name: 'x' })).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it('remove of a missing product throws 404', async () => {
    const service = makeService({ softDelete: () => Promise.resolve(undefined) });
    await expect(service.remove('missing')).rejects.toMatchObject({ statusCode: 404 });
  });

  it('getPublic of a missing/inactive product throws 404 (cache miss → repo)', async () => {
    const service = makeProductsService({
      productsRepo: { findActiveById: () => Promise.resolve(undefined) } as never,
      cache: { getItem: () => Promise.resolve(null), setItem: () => Promise.resolve() } as never,
      httpErrors,
    });
    await expect(service.getPublic('missing')).rejects.toMatchObject({ statusCode: 404 });
  });
});
