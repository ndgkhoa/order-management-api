import { eq } from 'drizzle-orm';
import type { ConsumeMessage } from 'amqplib';
import type { FastifyBaseLogger } from 'fastify';
import type { DB } from '@infra/db/client.js';
import { orderItems, outboxMessages } from '@infra/db/schema.js';
import type { HandlerResult } from '@infra/mq/consumer.js';
import { parseEnvelope, claimOnce } from '@infra/mq/idempotent-consumer.js';
import { PAYMENT_COMPENSATE_CONSUMER } from '@/constants/index.js';
import {
  ORDER_CANCELLED_EVENT,
  type PaymentSettledPayload,
  type OrderCancelledPayload,
} from '@infra/mq/outbox-event-types.js';
import { makeInventoryRepository } from '@modules/inventory/inventory-repository.js';
import { makeOrdersRepository } from '@modules/orders/orders-repository.js';
import { OrderStatuses } from '@/types/order-status.js';
import { OrderReasons } from '@/types/order-reasons.js';
import { sagaMetrics } from '@infra/telemetry/saga-metrics.js';

interface HandlerDeps {
  db: DB;
  log: FastifyBaseLogger;
}

export async function compensateOnPaymentFailed(
  msg: ConsumeMessage,
  { db, log }: HandlerDeps,
): Promise<HandlerResult> {
  const envelope = parseEnvelope<PaymentSettledPayload>(msg, log);
  if (!envelope) return 'ack';
  const eventId = envelope.eventId;
  const { orderId } = envelope.payload;
  const correlationId = envelope.correlationId || orderId;

  try {
    const ordersRepo = makeOrdersRepository(db);
    const inventoryRepo = makeInventoryRepository();
    let cancelled = false;
    await db.transaction(async (tx) => {
      if (!(await claimOnce(tx, PAYMENT_COMPENSATE_CONSUMER, eventId))) return;

      const didCancel = await ordersRepo.transition(
        tx,
        orderId,
        OrderStatuses.Pending,
        OrderStatuses.Cancelled,
        { reason: OrderReasons.PaymentFailed, cancelReason: OrderReasons.PaymentFailed },
      );
      if (!didCancel) {
        log.warn({ orderId }, 'order not pending at payment failure; skipping release');
        return;
      }
      cancelled = true;

      const items = await tx
        .select({ productId: orderItems.productId, quantity: orderItems.quantity })
        .from(orderItems)
        .where(eq(orderItems.orderId, orderId));
      for (const it of items) {
        const ok = await inventoryRepo.release(tx, it.productId, it.quantity);
        if (!ok) {
          sagaMetrics.anomalies.inc({ type: 'release_guard_failed' });
          log.warn({ orderId, productId: it.productId }, 'release guard failed');
        }
      }

      const payload: OrderCancelledPayload = { orderId, reason: OrderReasons.PaymentFailed };
      await tx.insert(outboxMessages).values({
        aggregateType: 'order',
        aggregateId: orderId,
        correlationId,
        eventType: ORDER_CANCELLED_EVENT,
        payload,
      });
    });
    if (cancelled) sagaMetrics.ordersCancelled.inc();
    return 'ack';
  } catch (err) {
    log.error({ err, eventId, orderId }, 'payment-compensate handler failed');
    return 'retry';
  }
}
