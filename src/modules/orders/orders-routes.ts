import { Type } from '@sinclair/typebox';
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { makeOrdersRepository } from '@modules/orders/orders-repository';
import { makeProductsRepository } from '@modules/products/products-repository';
import { makeOrdersService } from '@modules/orders/orders-service';
import { makeOrdersController } from '@modules/orders/orders-controller';
import { CreateOrderBody, OrderPublic, OrderDetail, IdParams } from '@modules/orders/orders-schema';
import { errorResponses } from '@infra/http/error-responses';

export const ordersRoutes: FastifyPluginAsyncTypebox = (app) => {
  const ordersRepo = makeOrdersRepository(app.db);
  const productsRepo = makeProductsRepository(app.db, app.redis);
  const service = makeOrdersService({ ordersRepo, productsRepo, httpErrors: app.httpErrors });
  const controller = makeOrdersController(service);

  app.post(
    '/',
    {
      preHandler: [app.authenticate, app.idempotency],
      schema: {
        tags: ['orders'],
        body: CreateOrderBody,
        response: { 201: OrderDetail, ...errorResponses(400, 401, 409) },
      },
    },
    controller.create,
  );

  app.get(
    '/',
    {
      preHandler: app.authenticate,
      schema: {
        tags: ['orders'],
        response: { 200: Type.Array(OrderPublic), ...errorResponses(401) },
      },
    },
    controller.list,
  );

  app.get(
    '/:id',
    {
      preHandler: app.authenticate,
      schema: {
        tags: ['orders'],
        params: IdParams,
        response: { 200: OrderDetail, ...errorResponses(401, 404) },
      },
    },
    controller.get,
  );

  app.post(
    '/:id/cancel',
    {
      preHandler: app.authenticate,
      schema: {
        tags: ['orders'],
        params: IdParams,
        response: { 200: OrderDetail, ...errorResponses(401, 404, 409) },
      },
    },
    controller.cancel,
  );

  return Promise.resolve();
};
