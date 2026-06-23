import type { FastifyReply, FastifyRequest } from 'fastify';
import { UserRoles } from '@/types/user-role.js';
import type { ProductsService } from '@modules/products/products-service.js';
import {
  type CreateProductBody,
  type UpdateProductBody,
  toProductPublic,
} from '@modules/products/products-schema.js';

/**
 * HTTP glue for /products. Mutations are admin-guarded at the route. Reads branch on role:
 * an admin (optional JWT present) sees all products fresh from the DB; everyone else gets
 * the cached active-only catalog. `req.body` is cast — the route schema already validated it.
 */
export function makeProductsController(service: ProductsService) {
  const isAdmin = (req: FastifyRequest) => req.user?.role === UserRoles.Admin;

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
      const rows = isAdmin(req) ? await service.listAll() : await service.listPublic();
      return rows.map(toProductPublic);
    },

    get: async (req: FastifyRequest) => {
      const { id } = req.params as { id: string };
      const product = isAdmin(req) ? await service.getAny(id) : await service.getPublic(id);
      return toProductPublic(product);
    },
  };
}

export type ProductsController = ReturnType<typeof makeProductsController>;
