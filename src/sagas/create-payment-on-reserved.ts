import { eq } from 'drizzle-orm';
import type { ConsumeMessage } from 'amqplib';
import type { FastifyBaseLogger } from 'fastify';
import type { DB } from '@infra/db/client';
import { orders, outboxMessages } from '@infra/db/schema';
import type { HandlerResult } from '@infra/mq/consumer';
import { parseEnvelope, claimOnce } from '@infra/mq/idempotent-consumer';
import { PAYMENT_CREATE_CONSUMER } from '@/constants/index';
import {
  PAYMENT_CREATED_EVENT,
  type InventoryReservedPayload,
  type PaymentCreatedPayload,
} from '@infra/mq/outbox-event-types';
import { makePaymentsRepository } from '@modules/payments/payments-repository';

interface HandlerDeps {
  db: DB;
  log: FastifyBaseLogger;
}

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
      if (!(await claimOnce(tx, PAYMENT_CREATE_CONSUMER, eventId))) return;

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
