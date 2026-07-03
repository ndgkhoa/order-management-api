import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { DB } from '@infra/db/client.js';
import { orders, orderItems, payments, outboxMessages } from '@infra/db/schema.js';
import {
  ORDER_CANCELLED_EVENT,
  ORDER_REFUNDED_EVENT,
  type OrderCancelledPayload,
  type OrderRefundedPayload,
} from '@infra/mq/outbox-event-types.js';
import { releaseReservation, restockAvailable } from '@modules/inventory/adjust-stock.js';
import { recordOrderTransition } from '@modules/orders/order-status-history.js';

const CUSTOMER_REASON = 'customer_cancelled';

interface CancelInput {
  orderId: string;
  requesterId: string;
  isAdmin: boolean;
}

/**
 * Cancel an order — customer (owner) or admin. IDOR guard: a non-admin can only cancel their
 * OWN order (else 404, indistinguishable from not-found). CAS-first on the current status (no
 * read-then-write) so it races safely against the shipping worker:
 *  - `paid`    → refund (payment paid→refunded) + restock (available+=q) + `order.refunded`
 *  - `pending` → release the reservation (available+=q, reserved-=q) + `order.cancelled`
 *  - otherwise (fulfilling/delivered/cancelled) → 409, the order can no longer be cancelled.
 */
export async function cancelOrder(
  db: DB,
  httpErrors: FastifyInstance['httpErrors'],
  { orderId, requesterId, isAdmin }: CancelInput,
) {
  const owned = await db.query.orders.findFirst({
    where: isAdmin
      ? eq(orders.id, orderId)
      : and(eq(orders.id, orderId), eq(orders.userId, requesterId)),
  });
  if (!owned) throw httpErrors.notFound('order not found');

  await db.transaction(async (tx) => {
    const items = await tx
      .select({ productId: orderItems.productId, quantity: orderItems.quantity })
      .from(orderItems)
      .where(eq(orderItems.orderId, orderId));

    // paid → refund + restock
    const refundRows = await tx
      .update(orders)
      .set({ status: 'cancelled', cancelReason: CUSTOMER_REASON, updatedAt: new Date() })
      .where(and(eq(orders.id, orderId), eq(orders.status, 'paid')))
      .returning({ id: orders.id });
    if (refundRows.length > 0) {
      await recordOrderTransition(tx, { orderId, from: 'paid', to: 'cancelled', reason: 'refund' });
      for (const it of items) await restockAvailable(tx, it.productId, it.quantity);
      const [refunded] = await tx
        .update(payments)
        .set({ status: 'refunded', updatedAt: new Date() })
        .where(and(eq(payments.orderId, orderId), eq(payments.status, 'paid')))
        .returning({ id: payments.id });
      const payload: OrderRefundedPayload = { orderId, paymentId: refunded?.id ?? '' };
      await tx.insert(outboxMessages).values({
        aggregateType: 'order',
        aggregateId: orderId,
        correlationId: orderId,
        eventType: ORDER_REFUNDED_EVENT,
        payload,
      });
      return;
    }

    // pending → release the reservation
    const releaseRows = await tx
      .update(orders)
      .set({ status: 'cancelled', cancelReason: CUSTOMER_REASON, updatedAt: new Date() })
      .where(and(eq(orders.id, orderId), eq(orders.status, 'pending')))
      .returning({ id: orders.id });
    if (releaseRows.length > 0) {
      await recordOrderTransition(tx, {
        orderId,
        from: 'pending',
        to: 'cancelled',
        reason: CUSTOMER_REASON,
      });
      for (const it of items) await releaseReservation(tx, it.productId, it.quantity);
      const payload: OrderCancelledPayload = { orderId, reason: CUSTOMER_REASON };
      await tx.insert(outboxMessages).values({
        aggregateType: 'order',
        aggregateId: orderId,
        correlationId: orderId,
        eventType: ORDER_CANCELLED_EVENT,
        payload,
      });
      return;
    }

    // already fulfilling/delivered/cancelled
    throw httpErrors.conflict('order can no longer be cancelled');
  });

  const order = await db.query.orders.findFirst({ where: eq(orders.id, orderId) });
  const items = await db.query.orderItems.findMany({ where: eq(orderItems.orderId, orderId) });
  return { order: order!, items };
}
