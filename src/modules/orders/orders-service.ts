import type { OrdersRepository } from './orders-repository.js';
import type { CreateOrderBody } from './orders-schema.js';

interface OrdersServiceDeps {
  ordersRepo: OrdersRepository;
}

/** Orders business logic. Thin today; the atomic write lives in the repository. */
export function makeOrdersService({ ordersRepo }: OrdersServiceDeps) {
  return {
    create(userId: string, email: string, dto: CreateOrderBody) {
      return ordersRepo.createWithOutbox({ userId, email, ...dto });
    },

    list(userId: string) {
      return ordersRepo.listByUser(userId);
    },
  };
}

export type OrdersService = ReturnType<typeof makeOrdersService>;
