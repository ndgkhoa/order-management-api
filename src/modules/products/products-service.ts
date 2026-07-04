import type { FastifyInstance } from 'fastify';
import type { ProductsRepository } from '@modules/products/products-repository.js';
import type { CreateProductBody, UpdateProductBody } from '@modules/products/products-schema.js';

interface ProductsServiceDeps {
  productsRepo: ProductsRepository;
  httpErrors: FastifyInstance['httpErrors'];
}

/**
 * Product business logic. Public reads delegate to the repository's read-through cache
 * (active-only). Admin reads bypass the cache. Every mutation triggers cache invalidation
 * inside the repository before returning. No DB or Redis wiring here.
 */
export function makeProductsService({ productsRepo, httpErrors }: ProductsServiceDeps) {
  return {
    // --- admin mutations ---
    async create(dto: CreateProductBody) {
      if (await productsRepo.findBySku(dto.sku)) {
        throw httpErrors.conflict('sku already exists');
      }
      return productsRepo.create(dto);
    },

    async update(id: string, patch: UpdateProductBody) {
      const updated = await productsRepo.update(id, patch);
      if (!updated) throw httpErrors.notFound('product not found');
      return updated;
    },

    async remove(id: string) {
      const removed = await productsRepo.softDelete(id);
      if (!removed) throw httpErrors.notFound('product not found');
    },

    // --- admin reads (bypass cache; see inactive) ---
    listAll: () => productsRepo.listAll(),

    async getAny(id: string) {
      const product = await productsRepo.findById(id);
      if (!product) throw httpErrors.notFound('product not found');
      return product;
    },

    // --- public reads (cache read-through via repository; active only) ---
    listPublic: () => productsRepo.listActive(),

    async getPublic(id: string) {
      const product = await productsRepo.findActiveById(id);
      if (!product) throw httpErrors.notFound('product not found');
      return product;
    },
  };
}

export type ProductsService = ReturnType<typeof makeProductsService>;
