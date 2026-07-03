import { and, eq } from 'drizzle-orm';
import type { ConsumeMessage } from 'amqplib';
import type { FastifyBaseLogger } from 'fastify';
import type { DB } from '@infra/db/client.js';
import { orders, orderItems, outboxMessages, processedMessages } from '@infra/db/schema.js';
import type { HandlerResult } from '@infra/mq/consumer.js';
import type { EventEnvelope } from '@infra/mq/event-envelope.js';
import {
  ORDER_CANCELLED_EVENT,
  type PaymentSettledPayload,
  type OrderCancelledPayload,
} from '@infra/mq/outbox-event-types.js';
import { releaseReservation } from '@modules/inventory/adjust-stock.js';
import { recordOrderTransition } from '@modules/orders/order-status-history.js';

const CONSUMER_NAME = 'payment-compensate';
const PAYMENT_FAILED_REASON = 'payment_failed';

interface HandlerDeps {
  db: DB;
  log: FastifyBaseLogger;
}

/**
 * `payment.failed` → the saga compensation: RELEASE the reservation (`available += q,
 * reserved -= q` per line) and cancel the order, then emit `order.cancelled`. One transaction,
 * idempotent by (consumer='payment-compensate', eventId). Compare-and-set on `pending` +
 * the guarded release make a duplicate a no-op (no double-release, no over-credited stock).
 */
export async function compensateOnPaymentFailed(
  msg: ConsumeMessage,
  { db, log }: HandlerDeps,
): Promise<HandlerResult> {
  let envelope: EventEnvelope<PaymentSettledPayload>;
  try {
    envelope = JSON.parse(msg.content.toString()) as EventEnvelope<PaymentSettledPayload>;
  } catch (err) {
    log.error({ err }, 'malformed payment.failed; dropping');
    return 'ack';
  }
  const eventId = envelope.eventId;
  if (!eventId) return 'ack';
  const { orderId } = envelope.payload;
  const correlationId = envelope.correlationId || orderId;

  try {
    await db.transaction(async (tx) => {
      const inserted = await tx
        .insert(processedMessages)
        .values({ consumerName: CONSUMER_NAME, eventId })
        .onConflictDoNothing()
        .returning();
      if (inserted.length === 0) return; // duplicate delivery

      const cancelledRows = await tx
        .update(orders)
        .set({ status: 'cancelled', cancelReason: PAYMENT_FAILED_REASON, updatedAt: new Date() })
        .where(and(eq(orders.id, orderId), eq(orders.status, 'pending')))
        .returning({ id: orders.id });
      if (cancelledRows.length === 0) {
        log.warn({ orderId }, 'order not pending at payment failure; skipping release');
        return;
      }
      await recordOrderTransition(tx, {
        orderId,
        from: 'pending',
        to: 'cancelled',
        reason: PAYMENT_FAILED_REASON,
      });

      const items = await tx
        .select({ productId: orderItems.productId, quantity: orderItems.quantity })
        .from(orderItems)
        .where(eq(orderItems.orderId, orderId));
      for (const it of items) {
        const ok = await releaseReservation(tx, it.productId, it.quantity);
        if (!ok) log.warn({ orderId, productId: it.productId }, 'release guard failed');
      }

      const payload: OrderCancelledPayload = { orderId, reason: PAYMENT_FAILED_REASON };
      await tx.insert(outboxMessages).values({
        aggregateType: 'order',
        aggregateId: orderId,
        correlationId,
        eventType: ORDER_CANCELLED_EVENT,
        payload,
      });
    });
    return 'ack';
  } catch (err) {
    log.error({ err, eventId, orderId }, 'payment-compensate handler failed');
    return 'retry';
  }
}
