import type { FastifyInstance } from 'fastify';
import type { ProductsRepository } from '@modules/products/products-repository';
import type { CreateProductBody, UpdateProductBody } from '@modules/products/products-schema';

interface ProductsServiceDeps {
  productsRepo: ProductsRepository;
  httpErrors: FastifyInstance['httpErrors'];
}

export function makeProductsService({ productsRepo, httpErrors }: ProductsServiceDeps) {
  return {
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

    listAll() {
      return productsRepo.listAll();
    },

    async getAny(id: string) {
      const product = await productsRepo.findById(id);
      if (!product) throw httpErrors.notFound('product not found');
      return product;
    },

    listPublic() {
      return productsRepo.listActive();
    },

    async getPublic(id: string) {
      const product = await productsRepo.findActiveById(id);
      if (!product) throw httpErrors.notFound('product not found');
      return product;
    },
  };
}

export type ProductsService = ReturnType<typeof makeProductsService>;
