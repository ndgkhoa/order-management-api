import type { FastifyReply, FastifyRequest } from 'fastify';
import { Permissions } from '@/types/permission.js';
import { hasPermission } from '@plugins/rbac.js';
import type { ProductsService } from '@modules/products/products-service.js';
import {
  type CreateProductBody,
  type UpdateProductBody,
  toProductPublic,
} from '@modules/products/products-schema.js';

export function makeProductsController(service: ProductsService) {
  return {
    create: async (req: FastifyRequest, reply: FastifyReply) => {
      const product = await service.create(req.body as CreateProductBody);
      return reply.code(201).send(toProductPublic(product));
    },

    update: async (req: FastifyRequest) => {
      const { id } = req.params as { id: string };
      const product = await service.update(id, req.body as UpdateProductBody);
      return toProductPublic(product);
    },

    remove: async (req: FastifyRequest, reply: FastifyReply) => {
      const { id } = req.params as { id: string };
      await service.remove(id);
      return reply.code(204).send();
    },

    list: async (req: FastifyRequest) => {
      const rows = hasPermission(req.user?.roles, Permissions.Product.Read)
        ? await service.listAll()
        : await service.listPublic();
      return rows.map(toProductPublic);
    },

    get: async (req: FastifyRequest) => {
      const { id } = req.params as { id: string };
      const product = hasPermission(req.user?.roles, Permissions.Product.Read)
        ? await service.getAny(id)
        : await service.getPublic(id);
      return toProductPublic(product);
    },
  };
}

export type ProductsController = ReturnType<typeof makeProductsController>;
