import { Type } from '@sinclair/typebox';
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { makeOrdersRepository } from '@modules/orders/orders-repository.js';
import { makeProductsRepository } from '@modules/products/products-repository.js';
import { makeOrdersService } from '@modules/orders/orders-service.js';
import { makeOrdersController } from '@modules/orders/orders-controller.js';
import {
  CreateOrderBody,
  OrderPublic,
  OrderDetail,
  IdParams,
} from '@modules/orders/orders-schema.js';
import { errorResponses } from '@infra/http/error-responses.js';

/** /orders routes — all authenticated. POST creates order + items + outbox atomically. */
export const ordersRoutes: FastifyPluginAsyncTypebox = (app) => {
  const ordersRepo = makeOrdersRepository(app.db);
  const productsRepo = makeProductsRepository(app.db, app.redis);
  const service = makeOrdersService({ ordersRepo, productsRepo, httpErrors: app.httpErrors });
  const controller = makeOrdersController(service);

  app.post(
    '/',
    {
      // idempotency runs after authenticate so the key is scoped to the verified user;
      // a retried Idempotency-Key replays the original 201 instead of creating a duplicate.
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

  // Customer (owner) or admin cancel. Pre-ship only: paid → refund+restock, pending → release;
  // fulfilling/delivered → 409. Ownership is enforced inside service.cancel (IDOR guard).
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
