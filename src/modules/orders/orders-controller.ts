import type { FastifyReply, FastifyRequest } from 'fastify';
import { Permissions } from '@/types/permission';
import { hasPermission } from '@plugins/rbac';
import type { OrdersService } from '@modules/orders/orders-service';
import { type CreateOrderBody, toOrderPublic, toOrderDetail } from '@modules/orders/orders-schema';

export function makeOrdersController(service: OrdersService) {
  return {
    create: async (req: FastifyRequest, reply: FastifyReply) => {
      const dto = req.body as CreateOrderBody;
      const { order, items } = await service.create(req.user.sub, dto);
      return reply.code(201).send(toOrderDetail(order, items));
    },

    list: async (req: FastifyRequest) => {
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

    cancel: async (req: FastifyRequest, reply: FastifyReply) => {
      const { id } = req.params as { id: string };
      const { order, items } = await service.cancel({
        orderId: id,
        requesterId: req.user.sub,
        canCancelAny: hasPermission(req.user.roles, Permissions.Order.CancelAny),
      });
      return reply.code(200).send(toOrderDetail(order, items));
    },
  };
}

export type OrdersController = ReturnType<typeof makeOrdersController>;
