import type { FastifyReply, FastifyRequest } from 'fastify';
import type { OrdersService } from '@modules/orders/orders-service.js';
import { type CreateOrderBody, toOrderPublic } from '@modules/orders/orders-schema.js';

/**
 * HTTP glue for /orders. userId/email come from the verified JWT, never the body.
 *
 * Note: with a `preHandler` on the route, Fastify's TypeBox provider can't infer the
 * body type into a handler defined in a separate file, so we cast `req.body`. This is
 * sound because the route's `CreateOrderBody` schema already validated it at runtime.
 */
export function makeOrdersController(service: OrdersService) {
  return {
    create: async (req: FastifyRequest, reply: FastifyReply) => {
      const dto = req.body as CreateOrderBody;
      const order = await service.create(req.user.sub, req.user.email, dto);
      return reply.code(201).send(toOrderPublic(order));
    },

    list: async (req: FastifyRequest) => {
      const list = await service.list(req.user.sub);
      return list.map(toOrderPublic);
    },
  };
}

export type OrdersController = ReturnType<typeof makeOrdersController>;
