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
import { transitionOrder } from '@modules/orders/transition-order.js';
import { OrderStatuses } from '@/types/order-status.js';
import { PaymentStatuses } from '@/types/payment-status.js';
import { sagaMetrics } from '@infra/telemetry/saga-metrics.js';

const CUSTOMER_REASON = 'customer_cancelled';

interface CancelInput {
  orderId: string;
  requesterId: string;
  /** True when the caller holds `order:cancel:any` — lets them cancel an order they do not own. */
  canCancelAny: boolean;
}

/**
 * Cancel an order — the owner, or a caller with `order:cancel:any`. IDOR guard: without that
 * permission a caller can only cancel their OWN order (else 404, indistinguishable from
 * not-found). CAS-first on the current status (no read-then-write) so it races safely against
 * the shipping worker:
 *  - `paid`    → refund (payment paid→refunded) + restock (available+=q) + `order.refunded`
 *  - `pending` → release the reservation (available+=q, reserved-=q) + `order.cancelled`
 *  - otherwise (fulfilling/delivered/cancelled) → 409, the order can no longer be cancelled.
 */
export async function cancelOrder(
  db: DB,
  httpErrors: FastifyInstance['httpErrors'],
  { orderId, requesterId, canCancelAny }: CancelInput,
) {
  const owned = await db.query.orders.findFirst({
    where: canCancelAny
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
    const didRefund = await transitionOrder(
      tx,
      orderId,
      OrderStatuses.Paid,
      OrderStatuses.Cancelled,
      {
        reason: 'refund',
        cancelReason: CUSTOMER_REASON,
      },
    );
    if (didRefund) {
      for (const it of items) await restockAvailable(tx, it.productId, it.quantity);
      const [refunded] = await tx
        .update(payments)
        .set({ status: PaymentStatuses.Refunded, updatedAt: new Date() })
        .where(and(eq(payments.orderId, orderId), eq(payments.status, PaymentStatuses.Paid)))
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
    const released = await transitionOrder(
      tx,
      orderId,
      OrderStatuses.Pending,
      OrderStatuses.Cancelled,
      {
        reason: CUSTOMER_REASON,
        cancelReason: CUSTOMER_REASON,
      },
    );
    if (released) {
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
  // Reached only when the transaction committed a cancellation (the 409 path throws above).
  sagaMetrics.ordersCancelled.inc();

  const order = await db.query.orders.findFirst({ where: eq(orders.id, orderId) });
  const items = await db.query.orderItems.findMany({ where: eq(orderItems.orderId, orderId) });
  return { order: order!, items };
}
