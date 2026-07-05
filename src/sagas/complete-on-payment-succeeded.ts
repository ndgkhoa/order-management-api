import { eq } from 'drizzle-orm';
import type { ConsumeMessage } from 'amqplib';
import type { FastifyBaseLogger } from 'fastify';
import type { DB } from '@infra/db/client';
import { orderItems, outboxMessages } from '@infra/db/schema';
import type { HandlerResult } from '@infra/mq/consumer';
import { parseEnvelope, claimOnce } from '@infra/mq/idempotent-consumer';
import { PAYMENT_COMPLETE_CONSUMER } from '@/constants/index';
import {
  ORDER_PAID_EVENT,
  type PaymentSettledPayload,
  type OrderPaidPayload,
} from '@infra/mq/outbox-event-types';
import { makeInventoryRepository } from '@modules/inventory/inventory-repository';
import { makeOrdersRepository } from '@modules/orders/orders-repository';
import { OrderStatuses } from '@/types/order-status';
import { sagaMetrics } from '@infra/telemetry/saga-metrics';

interface HandlerDeps {
  db: DB;
  log: FastifyBaseLogger;
}

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
    const inventoryRepo = makeInventoryRepository();
    await db.transaction(async (tx) => {
      if (!(await claimOnce(tx, PAYMENT_COMPLETE_CONSUMER, eventId))) return;

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
        const ok = await inventoryRepo.commit(tx, it.productId, it.quantity);
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
