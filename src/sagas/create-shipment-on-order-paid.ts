import type { ConsumeMessage } from 'amqplib';
import type { FastifyBaseLogger } from 'fastify';
import type { DB } from '@infra/db/client.js';
import { shipments, outboxMessages } from '@infra/db/schema.js';
import type { HandlerResult } from '@infra/mq/consumer.js';
import { parseEnvelope, claimOnce } from '@infra/mq/idempotent-consumer.js';
import { SHIPPING_CONSUMER } from '@/constants/index.js';
import {
  SHIPMENT_CREATED_EVENT,
  type OrderPaidPayload,
  type ShipmentEventPayload,
} from '@infra/mq/outbox-event-types.js';
import { makeOrdersRepository } from '@modules/orders/orders-repository.js';
import { OrderStatuses } from '@/types/order-status.js';
import { ShipmentStatuses } from '@/types/shipment-status.js';

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
  const envelope = parseEnvelope<OrderPaidPayload>(msg, log);
  if (!envelope) return { result: 'ack' };
  const eventId = envelope.eventId;
  const { orderId } = envelope.payload;
  const correlationId = envelope.correlationId || orderId;

  try {
    const ordersRepo = makeOrdersRepository(db);
    let shipmentId: string | undefined;
    await db.transaction(async (tx) => {
      if (!(await claimOnce(tx, SHIPPING_CONSUMER, eventId))) return; // duplicate delivery

      // Win the order first: this CAS acquires the order row lock, so a concurrent cancel is
      // serialized behind us and will find status='fulfilling' → rejected. Only if we win do we
      // create the shipment — never leave an orphaned/advancing shipment for a cancelled order.
      const moved = await ordersRepo.transition(
        tx,
        orderId,
        OrderStatuses.Paid,
        OrderStatuses.Fulfilling,
        { reason: 'shipment_created' },
      );
      if (!moved) {
        log.warn({ orderId }, 'order not paid at shipment creation (cancelled/advanced); skipping');
        return;
      }

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

      const payload: ShipmentEventPayload = {
        orderId,
        shipmentId: ship.id,
        status: ShipmentStatuses.Pending,
      };
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
