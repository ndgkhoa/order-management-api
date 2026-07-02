import { and, desc, eq } from 'drizzle-orm';
import { context, propagation } from '@opentelemetry/api';
import type { DB } from '@infra/db/client.js';
import { orders, orderItems, outboxMessages } from '@infra/db/schema.js';
import { ORDER_CREATED_EVENT, type OrderCreatedPayload } from '@infra/mq/outbox-event-types.js';
import type { OrderLine } from '@modules/orders/order-total.js';

interface CreateOrderInput {
  userId: string;
  email: string; // carried into the event payload (no extra query in the worker)
  lines: OrderLine[]; // pre-validated + price-snapshotted by the service
  totalCents: number;
}

/** Data access for orders. The create path is the Transactional Outbox core. */
export function makeOrdersRepository(db: DB) {
  return {
    /**
     * Writes the order header, its line items, AND the `order.created` outbox row in ONE
     * transaction — all commit together or none does, so the event can never be lost or
     * orphaned. NO stock reservation and NO payment here; those are async saga steps.
     */
    async createWithOutbox(input: CreateOrderInput) {
      return db.transaction(async (tx) => {
        const orderRows = await tx
          .insert(orders)
          .values({ userId: input.userId, totalCents: input.totalCents })
          .returning();
        const order = orderRows[0];
        if (!order) throw new Error('order insert returned no row');

        const itemRows = await tx
          .insert(orderItems)
          .values(input.lines.map((l) => ({ orderId: order.id, ...l })))
          .returning();

        const payload: OrderCreatedPayload = {
          orderId: order.id,
          userId: order.userId,
          email: input.email,
          items: input.lines.map((l) => ({
            productId: l.productId,
            sku: l.skuSnapshot,
            unitPriceCents: l.unitPriceCents,
            quantity: l.quantity,
          })),
          totalCents: order.totalCents,
        };
        // Capture the active (request) trace context into a W3C carrier so the relay can
        // resume THIS trace at publish time — without it the relay's later publish starts
        // a brand-new trace, splitting the request and the worker apart.
        const carrier: Record<string, string> = {};
        propagation.inject(context.active(), carrier);

        await tx.insert(outboxMessages).values({
          aggregateType: 'order',
          aggregateId: order.id,
          correlationId: order.id, // saga correlation = order id; event_id defaults to a fresh uuid
          eventType: ORDER_CREATED_EVENT,
          payload,
          traceContext: Object.keys(carrier).length > 0 ? carrier : null,
        });

        return { order, items: itemRows };
      });
    },

    listByUser: (userId: string) =>
      db.query.orders.findMany({
        where: eq(orders.userId, userId),
        orderBy: desc(orders.createdAt),
      }),

    /** Owner-scoped fetch (order + items). Returns undefined if missing or not owned. */
    async findByIdForUser(orderId: string, userId: string) {
      const order = await db.query.orders.findFirst({
        where: and(eq(orders.id, orderId), eq(orders.userId, userId)),
      });
      if (!order) return undefined;
      const items = await db.query.orderItems.findMany({
        where: eq(orderItems.orderId, orderId),
      });
      return { order, items };
    },
  };
}

export type OrdersRepository = ReturnType<typeof makeOrdersRepository>;
