import { describe, it, expect } from 'vitest';
import { makeProductsService } from '@modules/products/products-service.js';
import type { ProductsRepository } from '@modules/products/products-repository.js';
import { httpErrorsStub } from '@test/helpers/http-errors.js';

function makeSUT(repo: Partial<Record<keyof ProductsRepository, unknown>>) {
  return makeProductsService({
    productsRepo: repo as unknown as ProductsRepository,
    httpErrors: httpErrorsStub,
  });
}

describe('productsService', () => {
  describe('create', () => {
    it('rejects a duplicate SKU with 409', async () => {
      const service = makeSUT({
        findBySku: () => Promise.resolve({ id: 'x' } as never),
        create: () => Promise.reject(new Error('should not be called')),
      });
      await expect(
        service.create({ sku: 'DUP', name: 'n', priceCents: 100 }),
      ).rejects.toMatchObject({ statusCode: 409 });
    });

    it('inserts when the SKU is free', async () => {
      const created = { id: '1', sku: 'NEW' };
      const service = makeSUT({
        findBySku: () => Promise.resolve(undefined),
        create: () => Promise.resolve(created as never),
      });
      await expect(service.create({ sku: 'NEW', name: 'n', priceCents: 100 })).resolves.toBe(
        created,
      );
    });
  });

  describe('update', () => {
    it('throws 404 for a missing product', async () => {
      const service = makeSUT({ update: () => Promise.resolve(undefined) });
      await expect(service.update('missing', { name: 'x' })).rejects.toMatchObject({
        statusCode: 404,
      });
    });
  });

  describe('remove', () => {
    it('throws 404 for a missing product', async () => {
      const service = makeSUT({ softDelete: () => Promise.resolve(undefined) });
      await expect(service.remove('missing')).rejects.toMatchObject({ statusCode: 404 });
    });
  });

  describe('getPublic', () => {
    it('throws 404 for a missing/inactive product (cache miss → repo)', async () => {
      const service = makeSUT({ findActiveById: () => Promise.resolve(undefined) });
      await expect(service.getPublic('missing')).rejects.toMatchObject({ statusCode: 404 });
    });
  });
});
