import { Type } from '@sinclair/typebox';
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { makeOrdersRepository } from './orders-repository.js';
import { makeOrdersService } from './orders-service.js';
import { makeOrdersController } from './orders-controller.js';
import { CreateOrderBody, OrderPublic } from './orders-schema.js';

/** /orders routes — all authenticated. POST creates order + outbox row atomically. */
export const ordersRoutes: FastifyPluginAsyncTypebox = (app) => {
  const ordersRepo = makeOrdersRepository(app.db);
  const service = makeOrdersService({ ordersRepo });
  const controller = makeOrdersController(service);

  app.post(
    '/',
    {
      preHandler: app.authenticate,
      schema: { body: CreateOrderBody, response: { 201: OrderPublic } },
    },
    controller.create,
  );

  app.get(
    '/',
    {
      preHandler: app.authenticate,
      schema: { response: { 200: Type.Array(OrderPublic) } },
    },
    controller.list,
  );

  return Promise.resolve();
};
