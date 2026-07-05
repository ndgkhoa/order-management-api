import type { ConsumeMessage } from 'amqplib';
import type { FastifyBaseLogger } from 'fastify';
import type { DB } from '@infra/db/client';
import { shipments, outboxMessages } from '@infra/db/schema';
import type { HandlerResult } from '@infra/mq/consumer';
import { parseEnvelope, claimOnce } from '@infra/mq/idempotent-consumer';
import { SHIPPING_CONSUMER } from '@/constants/index';
import {
  SHIPMENT_CREATED_EVENT,
  type OrderPaidPayload,
  type ShipmentEventPayload,
} from '@infra/mq/outbox-event-types';
import { makeOrdersRepository } from '@modules/orders/orders-repository';
import { OrderStatuses } from '@/types/order-status';
import { ShipmentStatuses } from '@/types/shipment-status';

interface HandlerDeps {
  db: DB;
  log: FastifyBaseLogger;
}

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
      if (!(await claimOnce(tx, SHIPPING_CONSUMER, eventId))) return;

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
