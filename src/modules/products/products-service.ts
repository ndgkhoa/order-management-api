import type { FastifyInstance } from 'fastify';
import type { ProductsRepository } from '@modules/products/products-repository.js';
import type { ProductsCache } from '@modules/products/products-cache.js';
import type { CreateProductBody, UpdateProductBody } from '@modules/products/products-schema.js';

interface ProductsServiceDeps {
  productsRepo: ProductsRepository;
  cache: ProductsCache;
  httpErrors: FastifyInstance['httpErrors'];
}

/**
 * Product business logic. Public reads go through the Redis cache (active-only); admin
 * reads bypass the cache. Every mutation invalidates the cache before returning.
 */
export function makeProductsService({ productsRepo, cache, httpErrors }: ProductsServiceDeps) {
  return {
    // --- admin mutations ---
    async create(dto: CreateProductBody) {
      if (await productsRepo.findBySku(dto.sku)) {
        throw httpErrors.conflict('sku already exists');
      }
      const product = await productsRepo.create(dto);
      await cache.invalidate();
      return product;
    },

    async update(id: string, patch: UpdateProductBody) {
      const updated = await productsRepo.update(id, patch);
      if (!updated) throw httpErrors.notFound('product not found');
      await cache.invalidate(id);
      return updated;
    },

    async remove(id: string) {
      const removed = await productsRepo.softDelete(id);
      if (!removed) throw httpErrors.notFound('product not found');
      await cache.invalidate(id);
    },

    // --- admin reads (bypass cache; see inactive) ---
    listAll: () => productsRepo.listAll(),

    async getAny(id: string) {
      const product = await productsRepo.findById(id);
      if (!product) throw httpErrors.notFound('product not found');
      return product;
    },

    // --- public reads (cache read-through; active only) ---
    async listPublic() {
      const cached = await cache.getList();
      if (cached) return cached;
      const rows = await productsRepo.listActive();
      await cache.setList(rows);
      return rows;
    },

    async getPublic(id: string) {
      const cached = await cache.getItem(id);
      if (cached) return cached;
      const product = await productsRepo.findActiveById(id);
      if (!product) throw httpErrors.notFound('product not found');
      await cache.setItem(product);
      return product;
    },
  };
}

export type ProductsService = ReturnType<typeof makeProductsService>;
