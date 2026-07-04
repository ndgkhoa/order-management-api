import { eq } from 'drizzle-orm';
import type { ConsumeMessage } from 'amqplib';
import type { FastifyBaseLogger } from 'fastify';
import type { DB } from '@infra/db/client.js';
import { orderItems, outboxMessages } from '@infra/db/schema.js';
import type { HandlerResult } from '@infra/mq/consumer.js';
import { parseEnvelope, claimOnce } from '@infra/mq/idempotent-consumer.js';
import {
  ORDER_PAID_EVENT,
  type PaymentSettledPayload,
  type OrderPaidPayload,
} from '@infra/mq/outbox-event-types.js';
import { commitReservation } from '@modules/inventory/adjust-stock.js';
import { makeOrdersRepository } from '@modules/orders/orders-repository.js';
import { OrderStatuses } from '@/types/order-status.js';
import { sagaMetrics } from '@infra/telemetry/saga-metrics.js';

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
  const envelope = parseEnvelope<PaymentSettledPayload>(msg, log);
  if (!envelope) return 'ack';
  const eventId = envelope.eventId;
  const { orderId, paymentId } = envelope.payload;
  const correlationId = envelope.correlationId || orderId;

  try {
    const ordersRepo = makeOrdersRepository(db);
    await db.transaction(async (tx) => {
      if (!(await claimOnce(tx, CONSUMER_NAME, eventId))) return; // duplicate delivery

      const paid = await ordersRepo.transition(
        tx,
        orderId,
        OrderStatuses.Pending,
        OrderStatuses.Paid,
        {
          reason: 'payment_succeeded',
        },
      );
      if (!paid) {
        log.warn({ orderId }, 'order not pending at payment success; skipping commit');
        return;
      }

      const items = await tx
        .select({ productId: orderItems.productId, quantity: orderItems.quantity })
        .from(orderItems)
        .where(eq(orderItems.orderId, orderId));
      for (const it of items) {
        const ok = await commitReservation(tx, it.productId, it.quantity);
        if (!ok) {
          sagaMetrics.anomalies.inc({ type: 'commit_guard_failed' });
          log.warn({ orderId, productId: it.productId }, 'commit guard failed');
        }
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
