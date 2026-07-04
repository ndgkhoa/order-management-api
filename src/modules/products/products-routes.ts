import { Type } from '@sinclair/typebox';
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import type { FastifyRequest } from 'fastify';
import { Permissions } from '@/types/permission.js';
import { makeProductsRepository } from '@modules/products/products-repository.js';
import { makeProductsService } from '@modules/products/products-service.js';
import { makeProductsController } from '@modules/products/products-controller.js';
import {
  CreateProductBody,
  UpdateProductBody,
  ProductPublic,
  IdParams,
} from '@modules/products/products-schema.js';
import { errorResponses } from '@infra/http/error-responses.js';

/**
 * /products routes. Each mutation requires its own `product:{create|update|delete}` permission
 * (authenticate + requirePermission). Reads are public but optionally authenticated: a valid token
 * populates `request.user` so a caller with `product:read` sees all products (controller branches
 * on permission); without a token the cached active-only catalog is served. Bad/absent tokens
 * never 401 a read.
 */
export const productsRoutes: FastifyPluginAsyncTypebox = (app) => {
  const productsRepo = makeProductsRepository(app.db, app.redis);
  const service = makeProductsService({ productsRepo, httpErrors: app.httpErrors });
  const controller = makeProductsController(service);

  // Reads: verify the token if present, but never reject when it's missing/invalid.
  const optionalAuth = async (request: FastifyRequest) => {
    try {
      await request.jwtVerify();
    } catch {
      /* anonymous read — leave request.user unset */
    }
  };

  app.post(
    '/',
    {
      preHandler: [app.authenticate, app.requirePermission(Permissions.Product.Create)],
      schema: {
        tags: ['products'],
        body: CreateProductBody,
        response: { 201: ProductPublic, ...errorResponses(400, 401, 403, 409) },
      },
    },
    controller.create,
  );

  app.patch(
    '/:id',
    {
      preHandler: [app.authenticate, app.requirePermission(Permissions.Product.Update)],
      schema: {
        tags: ['products'],
        params: IdParams,
        body: UpdateProductBody,
        response: { 200: ProductPublic, ...errorResponses(400, 401, 403, 404) },
      },
    },
    controller.update,
  );

  app.delete(
    '/:id',
    {
      preHandler: [app.authenticate, app.requirePermission(Permissions.Product.Delete)],
      schema: { tags: ['products'], params: IdParams, response: errorResponses(401, 403, 404) },
    },
    controller.remove,
  );

  app.get(
    '/',
    {
      preHandler: optionalAuth,
      schema: { tags: ['products'], security: [], response: { 200: Type.Array(ProductPublic) } },
    },
    controller.list,
  );

  app.get(
    '/:id',
    {
      preHandler: optionalAuth,
      schema: {
        tags: ['products'],
        security: [],
        params: IdParams,
        response: { 200: ProductPublic, ...errorResponses(404) },
      },
    },
    controller.get,
  );

  return Promise.resolve();
};
