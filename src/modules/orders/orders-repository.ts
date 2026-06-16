import { desc, eq } from 'drizzle-orm';
import { context, propagation } from '@opentelemetry/api';
import type { DB } from '@infra/db/client.js';
import { orders, outboxMessages } from '@infra/db/schema.js';
import { ORDER_CREATED_EVENT, type OrderCreatedPayload } from '@infra/mq/outbox-event-types.js';
import type { CreateOrderBody } from '@modules/orders/orders-schema.js';

interface CreateOrderInput extends CreateOrderBody {
  userId: string;
  email: string; // carried into the event payload (no extra query in the worker)
}

/** Data access for orders. The create path is the Transactional Outbox core. */
export function makeOrdersRepository(db: DB) {
  return {
    /**
     * Writes the order AND its `order.created` outbox row in ONE transaction.
     * Either both commit or neither does — the event can never be lost or orphaned.
     */
    async createWithOutbox(input: CreateOrderInput) {
      return db.transaction(async (tx) => {
        const rows = await tx
          .insert(orders)
          .values({
            userId: input.userId,
            product: input.product,
            quantity: input.quantity,
            amount: input.amount,
          })
          .returning();
        const order = rows[0];
        if (!order) throw new Error('order insert returned no row');

        const payload: OrderCreatedPayload = {
          orderId: order.id,
          userId: order.userId,
          email: input.email,
          product: order.product,
          quantity: order.quantity,
          amount: order.amount,
        };
        // Capture the active (request) trace context into a W3C carrier so the relay
        // can resume THIS trace at publish time — without it the relay's later publish
        // starts a brand-new trace, splitting the request and the email worker apart.
        const carrier: Record<string, string> = {};
        propagation.inject(context.active(), carrier);

        await tx.insert(outboxMessages).values({
          aggregateType: 'order',
          aggregateId: order.id,
          eventType: ORDER_CREATED_EVENT,
          payload,
          traceContext: Object.keys(carrier).length > 0 ? carrier : null,
        });

        return order; // both committed together
      });
    },

    listByUser: (userId: string) =>
      db.query.orders.findMany({
        where: eq(orders.userId, userId),
        orderBy: desc(orders.createdAt),
      }),
  };
}

export type OrdersRepository = ReturnType<typeof makeOrdersRepository>;
