import type { FastifyInstance } from 'fastify';
import type { OrdersRepository } from '@modules/orders/orders-repository';
import type { ProductsRepository } from '@modules/products/products-repository';
import type {
  CreateOrderBody,
  CancelOrderInput,
  OrderLine,
  SnapshotProduct,
} from '@modules/orders/orders-schema';
import { sagaMetrics } from '@infra/telemetry/saga-metrics';

interface OrdersServiceDeps {
  ordersRepo: OrdersRepository;
  productsRepo: ProductsRepository;
  httpErrors: FastifyInstance['httpErrors'];
}

export function makeOrdersService({ ordersRepo, productsRepo, httpErrors }: OrdersServiceDeps) {
  return {
    async create(userId: string, dto: CreateOrderBody) {
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
      return ordersRepo.createWithOutbox({ userId, lines, totalCents });
    },

    list(userId: string) {
      return ordersRepo.listByUser(userId);
    },

    listAll() {
      return ordersRepo.listAll();
    },

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
