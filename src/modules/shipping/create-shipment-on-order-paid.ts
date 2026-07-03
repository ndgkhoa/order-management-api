import { and, eq } from 'drizzle-orm';
import type { ConsumeMessage } from 'amqplib';
import type { FastifyBaseLogger } from 'fastify';
import type { DB } from '@infra/db/client.js';
import { shipments, orders, outboxMessages, processedMessages } from '@infra/db/schema.js';
import type { HandlerResult } from '@infra/mq/consumer.js';
import type { EventEnvelope } from '@infra/mq/event-envelope.js';
import {
  SHIPMENT_CREATED_EVENT,
  type OrderPaidPayload,
  type ShipmentEventPayload,
} from '@infra/mq/outbox-event-types.js';
import { recordOrderTransition } from '@modules/orders/order-status-history.js';

const CONSUMER_NAME = 'shipping';

interface HandlerDeps {
  db: DB;
  log: FastifyBaseLogger;
}

/**
 * `order.paid` → create the order's single shipment (pending), move the order
 * `paid → fulfilling`, record the history row, and emit `shipment.created` — one transaction,
 * idempotent by (consumer='shipping', eventId) plus the unique `order_id`. Returns the new
 * `shipmentId` so the worker can schedule the timed advances (undefined if it was a duplicate).
 */
export async function createShipmentOnOrderPaid(
  msg: ConsumeMessage,
  { db, log }: HandlerDeps,
): Promise<{ result: HandlerResult; shipmentId?: string }> {
  let envelope: EventEnvelope<OrderPaidPayload>;
  try {
    envelope = JSON.parse(msg.content.toString()) as EventEnvelope<OrderPaidPayload>;
  } catch (err) {
    log.error({ err }, 'malformed order.paid; dropping');
    return { result: 'ack' };
  }
  const eventId = envelope.eventId;
  if (!eventId) return { result: 'ack' };
  const { orderId } = envelope.payload;
  const correlationId = envelope.correlationId || orderId;

  try {
    let shipmentId: string | undefined;
    await db.transaction(async (tx) => {
      const inserted = await tx
        .insert(processedMessages)
        .values({ consumerName: CONSUMER_NAME, eventId })
        .onConflictDoNothing()
        .returning();
      if (inserted.length === 0) return; // duplicate delivery

      // Win the order first: this CAS acquires the order row lock, so a concurrent cancel is
      // serialized behind us and will find status='fulfilling' → rejected. Only if we win do we
      // create the shipment — never leave an orphaned/advancing shipment for a cancelled order.
      const moved = await tx
        .update(orders)
        .set({ status: 'fulfilling', updatedAt: new Date() })
        .where(and(eq(orders.id, orderId), eq(orders.status, 'paid')))
        .returning({ id: orders.id });
      if (moved.length === 0) {
        log.warn({ orderId }, 'order not paid at shipment creation (cancelled/advanced); skipping');
        return;
      }
      await recordOrderTransition(tx, {
        orderId,
        from: 'paid',
        to: 'fulfilling',
        reason: 'shipment_created',
      });

      const [ship] = await tx
        .insert(shipments)
        .values({ orderId })
        .onConflictDoNothing({ target: shipments.orderId })
        .returning({ id: shipments.id });
      if (!ship) {
        log.warn({ orderId }, 'shipment already exists; skipping create');
        return;
      }
      shipmentId = ship.id;

      const payload: ShipmentEventPayload = { orderId, shipmentId: ship.id, status: 'pending' };
      await tx.insert(outboxMessages).values({
        aggregateType: 'order',
        aggregateId: orderId,
        correlationId,
        eventType: SHIPMENT_CREATED_EVENT,
        payload,
      });
    });
    return { result: 'ack', shipmentId };
  } catch (err) {
    log.error({ err, eventId, orderId }, 'create-shipment handler failed');
    return { result: 'retry' };
  }
}
