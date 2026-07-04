import type { FastifyReply, FastifyRequest } from 'fastify';
import { Permissions } from '@/domain/permission.js';
import { hasPermission } from '@/domain/role-permissions.js';
import type { OrdersService } from '@modules/orders/orders-service.js';
import {
  type CreateOrderBody,
  toOrderPublic,
  toOrderDetail,
} from '@modules/orders/orders-schema.js';

/**
 * HTTP glue for /orders. userId/email come from the verified JWT, never the body.
 * `req.body`/`req.params` are cast — the route schema already validated them at runtime
 * (the TypeBox provider can't infer types into handlers defined in a separate file).
 */
export function makeOrdersController(service: OrdersService) {
  return {
    create: async (req: FastifyRequest, reply: FastifyReply) => {
      const dto = req.body as CreateOrderBody;
      const { order, items } = await service.create(req.user.sub, req.user.email, dto);
      return reply.code(201).send(toOrderDetail(order, items));
    },

    list: async (req: FastifyRequest) => {
      // Callers with order:read:all see every order; everyone else sees only their own.
      const list = hasPermission(req.user.roles, Permissions.Order.ReadAll)
        ? await service.listAll()
        : await service.list(req.user.sub);
      return list.map(toOrderPublic);
    },

    get: async (req: FastifyRequest) => {
      const { id } = req.params as { id: string };
      const { order, items } = await service.getForUser(id, req.user.sub);
      return toOrderDetail(order, items);
    },
  };
}

export type OrdersController = ReturnType<typeof makeOrdersController>;
