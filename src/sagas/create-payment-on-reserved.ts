import { eq } from 'drizzle-orm';
import type { ConsumeMessage } from 'amqplib';
import type { FastifyBaseLogger } from 'fastify';
import type { DB } from '@infra/db/client.js';
import { orders, outboxMessages } from '@infra/db/schema.js';
import type { HandlerResult } from '@infra/mq/consumer.js';
import { parseEnvelope, claimOnce } from '@infra/mq/idempotent-consumer.js';
import { PAYMENT_CREATE_CONSUMER } from '@/constants/index.js';
import {
  PAYMENT_CREATED_EVENT,
  type InventoryReservedPayload,
  type PaymentCreatedPayload,
} from '@infra/mq/outbox-event-types.js';
import { makePaymentsRepository } from '@modules/payments/payments-repository.js';

interface HandlerDeps {
  db: DB;
  log: FastifyBaseLogger;
}

/**
 * `inventory.reserved` → create the order's single pending payment (amount = order total) and
 * emit `payment.created`, both in ONE transaction (outbox), idempotent by
 * (consumer='payment-create', eventId). The unique `order_id` on payments is a second guard:
 * if a payment already exists, we skip the emit rather than double-charge.
 */
export async function createPaymentOnReserved(
  msg: ConsumeMessage,
  { db, log }: HandlerDeps,
): Promise<HandlerResult> {
  const envelope = parseEnvelope<InventoryReservedPayload>(msg, log);
  if (!envelope) return 'ack';
  const eventId = envelope.eventId;
  const { orderId } = envelope.payload;
  const correlationId = envelope.correlationId || orderId;

  const paymentsRepo = makePaymentsRepository(db);
  try {
    await db.transaction(async (tx) => {
      if (!(await claimOnce(tx, PAYMENT_CREATE_CONSUMER, eventId))) return; // duplicate delivery

      const [order] = await tx
        .select({ totalCents: orders.totalCents })
        .from(orders)
        .where(eq(orders.id, orderId));
      if (!order) {
        log.warn({ orderId }, 'order not found for reserved event; skipping payment create');
        return;
      }

      const payment = await paymentsRepo.insertPendingPayment(tx, orderId, order.totalCents);
      if (!payment) {
        log.warn({ orderId }, 'payment already exists; skipping create emit');
        return;
      }

      const payload: PaymentCreatedPayload = {
        orderId,
        paymentId: payment.id,
        amountCents: order.totalCents,
      };
      await tx.insert(outboxMessages).values({
        aggregateType: 'order',
        aggregateId: orderId,
        correlationId,
        eventType: PAYMENT_CREATED_EVENT,
        payload,
      });
    });
    return 'ack';
  } catch (err) {
    log.error({ err, eventId, orderId }, 'create-payment handler failed');
    return 'retry';
  }
}
