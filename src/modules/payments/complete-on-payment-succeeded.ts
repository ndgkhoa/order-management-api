import { and, eq } from 'drizzle-orm';
import type { ConsumeMessage } from 'amqplib';
import type { FastifyBaseLogger } from 'fastify';
import type { DB } from '@infra/db/client.js';
import { orders, orderItems, outboxMessages, processedMessages } from '@infra/db/schema.js';
import type { HandlerResult } from '@infra/mq/consumer.js';
import type { EventEnvelope } from '@infra/mq/event-envelope.js';
import {
  ORDER_PAID_EVENT,
  type PaymentSettledPayload,
  type OrderPaidPayload,
} from '@infra/mq/outbox-event-types.js';
import { commitReservation } from '@modules/inventory/adjust-stock.js';
import { recordOrderTransition } from '@modules/orders/order-status-history.js';

const CONSUMER_NAME = 'payment-complete';

interface HandlerDeps {
  db: DB;
  log: FastifyBaseLogger;
}

/**
 * `payment.succeeded` → mark the order paid and COMMIT its reservation (`reserved -= q` per
 * line), then emit `order.paid`. One transaction, idempotent by (consumer='payment-complete',
 * eventId). Compare-and-set on `pending` makes a late/duplicate success a no-op — a `cancelled`
 * order is never revived to `paid`.
 */
export async function completeOnPaymentSucceeded(
  msg: ConsumeMessage,
  { db, log }: HandlerDeps,
): Promise<HandlerResult> {
  let envelope: EventEnvelope<PaymentSettledPayload>;
  try {
    envelope = JSON.parse(msg.content.toString()) as EventEnvelope<PaymentSettledPayload>;
  } catch (err) {
    log.error({ err }, 'malformed payment.succeeded; dropping');
    return 'ack';
  }
  const eventId = envelope.eventId;
  if (!eventId) return 'ack';
  const { orderId, paymentId } = envelope.payload;
  const correlationId = envelope.correlationId || orderId;

  try {
    await db.transaction(async (tx) => {
      const inserted = await tx
        .insert(processedMessages)
        .values({ consumerName: CONSUMER_NAME, eventId })
        .onConflictDoNothing()
        .returning();
      if (inserted.length === 0) return; // duplicate delivery

      const paidRows = await tx
        .update(orders)
        .set({ status: 'paid', updatedAt: new Date() })
        .where(and(eq(orders.id, orderId), eq(orders.status, 'pending')))
        .returning({ id: orders.id });
      if (paidRows.length === 0) {
        log.warn({ orderId }, 'order not pending at payment success; skipping commit');
        return;
      }
      await recordOrderTransition(tx, {
        orderId,
        from: 'pending',
        to: 'paid',
        reason: 'payment_succeeded',
      });

      const items = await tx
        .select({ productId: orderItems.productId, quantity: orderItems.quantity })
        .from(orderItems)
        .where(eq(orderItems.orderId, orderId));
      for (const it of items) {
        const ok = await commitReservation(tx, it.productId, it.quantity);
        if (!ok) log.warn({ orderId, productId: it.productId }, 'commit guard failed');
      }

      const payload: OrderPaidPayload = { orderId, paymentId };
      await tx.insert(outboxMessages).values({
        aggregateType: 'order',
        aggregateId: orderId,
        correlationId,
        eventType: ORDER_PAID_EVENT,
        payload,
      });
    });
    return 'ack';
  } catch (err) {
    log.error({ err, eventId, orderId }, 'payment-complete handler failed');
    return 'retry';
  }
}
