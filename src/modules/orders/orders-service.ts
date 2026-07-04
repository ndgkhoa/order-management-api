import type { FastifyInstance } from 'fastify';
import type { OrdersRepository } from '@modules/orders/orders-repository.js';
import type { ProductsRepository } from '@modules/products/products-repository.js';
import type {
  CreateOrderBody,
  CancelOrderInput,
  OrderLine,
  SnapshotProduct,
} from '@modules/orders/orders-schema.js';
import { sagaMetrics } from '@infra/telemetry/saga-metrics.js';

interface OrdersServiceDeps {
  ordersRepo: OrdersRepository;
  productsRepo: ProductsRepository;
  httpErrors: FastifyInstance['httpErrors'];
}

/**
 * Orders business logic. On create it validates every referenced product is active, snapshots the
 * current price + computes line/order totals, then hands the pre-validated lines to the
 * repository's atomic outbox write. Cancel maps the repository's outcome to HTTP errors. NO stock
 * reserve / payment here — those are async saga steps; all DB work lives in the repository.
 */
export function makeOrdersService({ ordersRepo, productsRepo, httpErrors }: OrdersServiceDeps) {
  return {
    async create(userId: string, email: string, dto: CreateOrderBody) {
      // One pass: validate each product is active, dedupe the DB lookup, and snapshot its price
      // into an immutable line. An unknown/inactive product is rejected synchronously as a 400.
      const seen = new Map<string, SnapshotProduct>();
      const lines: OrderLine[] = [];
      for (const item of dto.items) {
        let product = seen.get(item.productId);
        if (!product) {
          const found = await productsRepo.findActiveById(item.productId);
          if (!found) throw httpErrors.badRequest(`unknown or inactive product ${item.productId}`);
          product = found;
          seen.set(found.id, found);
        }
        lines.push({
          productId: product.id,
          skuSnapshot: product.sku,
          unitPriceCents: product.priceCents,
          quantity: item.quantity,
          lineTotalCents: product.priceCents * item.quantity,
        });
      }
      const totalCents = lines.reduce((sum, line) => sum + line.lineTotalCents, 0);
      return ordersRepo.createWithOutbox({ userId, email, lines, totalCents });
    },

    list: (userId: string) => ordersRepo.listByUser(userId),

    /** Admin listing: all orders regardless of owner. */
    listAll: () => ordersRepo.listAll(),

    async getForUser(orderId: string, userId: string) {
      const found = await ordersRepo.findByIdForUser(orderId, userId);
      if (!found) throw httpErrors.notFound('order not found');
      return found;
    },

    async cancel(input: CancelOrderInput) {
      const result = await ordersRepo.cancel(input);
      if (result.outcome === 'not_found') throw httpErrors.notFound('order not found');
      if (result.outcome === 'conflict') {
        throw httpErrors.conflict('order can no longer be cancelled');
      }
      sagaMetrics.ordersCancelled.inc();
      return { order: result.order, items: result.items };
    },
  };
}

export type OrdersService = ReturnType<typeof makeOrdersService>;
