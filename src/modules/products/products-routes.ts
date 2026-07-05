import { Type } from '@sinclair/typebox';
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Permissions } from '@/types/permission';
import { makeProductsRepository } from '@modules/products/products-repository';
import { makeProductsService } from '@modules/products/products-service';
import { makeProductsController } from '@modules/products/products-controller';
import {
  CreateProductBody,
  UpdateProductBody,
  ProductPublic,
  IdParams,
} from '@modules/products/products-schema';
import { errorResponses } from '@infra/http/error-responses';

export const productsRoutes: FastifyPluginAsyncTypebox = (app) => {
  const productsRepo = makeProductsRepository(app.db, app.redis);
  const service = makeProductsService({ productsRepo, httpErrors: app.httpErrors });
  const controller = makeProductsController(service);

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
      preHandler: app.optionalAuth,
      schema: { tags: ['products'], security: [], response: { 200: Type.Array(ProductPublic) } },
    },
    controller.list,
  );

  app.get(
    '/:id',
    {
      preHandler: app.optionalAuth,
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
