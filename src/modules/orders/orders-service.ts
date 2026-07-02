import type { FastifyInstance } from 'fastify';
import type { OrdersRepository } from '@modules/orders/orders-repository.js';
import type { ProductsRepository } from '@modules/products/products-repository.js';
import type { CreateOrderBody } from '@modules/orders/orders-schema.js';
import { buildOrderTotals, type SnapshotProduct } from '@modules/orders/order-total.js';

interface OrdersServiceDeps {
  ordersRepo: OrdersRepository;
  productsRepo: ProductsRepository;
  httpErrors: FastifyInstance['httpErrors'];
}

/**
 * Orders business logic. On create it validates every referenced product is active,
 * snapshots the current price, computes line + order totals (all in `order-total`), then
 * hands the pre-validated lines to the repository's atomic outbox write. NO stock reserve
 * / payment here — those are async saga steps in later phases.
 */
export function makeOrdersService({ ordersRepo, productsRepo, httpErrors }: OrdersServiceDeps) {
  return {
    async create(userId: string, email: string, dto: CreateOrderBody) {
      // Look up each referenced product (active only); reject unknown/inactive synchronously.
      const productsById = new Map<string, SnapshotProduct>();
      for (const item of dto.items) {
        if (productsById.has(item.productId)) continue;
        const product = await productsRepo.findActiveById(item.productId);
        if (!product) {
          throw httpErrors.badRequest(`unknown or inactive product ${item.productId}`);
        }
        productsById.set(product.id, product);
      }

      const { lines, totalCents } = buildOrderTotals(dto.items, productsById);
      return ordersRepo.createWithOutbox({ userId, email, lines, totalCents });
    },

    list: (userId: string) => ordersRepo.listByUser(userId),

    async getForUser(orderId: string, userId: string) {
      const found = await ordersRepo.findByIdForUser(orderId, userId);
      if (!found) throw httpErrors.notFound('order not found');
      return found;
    },
  };
}

export type OrdersService = ReturnType<typeof makeOrdersService>;
