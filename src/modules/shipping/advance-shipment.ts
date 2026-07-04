import { and, eq } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type { DB } from '@infra/db/client.js';
import { shipments, outboxMessages } from '@infra/db/schema.js';
import {
  SHIPMENT_READY_EVENT,
  SHIPMENT_IN_TRANSIT_EVENT,
  SHIPMENT_DELIVERED_EVENT,
  type ShipmentEventPayload,
} from '@infra/mq/outbox-event-types.js';
import { makeOrdersRepository } from '@modules/orders/orders-repository.js';
import { OrderStatuses } from '@/types/order-status.js';
import {
  ShipmentStatuses,
  SHIPMENT_TRANSITIONS,
  type ShipmentStatus,
  type AdvancedShipmentStatus,
} from '@/types/shipment-status.js';
import { nextStatus } from '@/utils/state-machine.js';
import { OrderReasons } from '@/types/order-reasons.js';
import { sagaMetrics } from '@infra/telemetry/saga-metrics.js';

const EVENT_BY_STATUS: Record<Exclude<ShipmentStatus, 'pending'>, string> = {
  ready_for_pickup: SHIPMENT_READY_EVENT,
  in_transit: SHIPMENT_IN_TRANSIT_EVENT,
  delivered: SHIPMENT_DELIVERED_EVENT,
};

/**
 * Advances a shipment exactly ONE step (pending→ready_for_pickup→in_transit→delivered) and
 * emits the matching event, all in one transaction. Compare-and-set on the current status
 * makes it idempotent and race-safe: a redelivery/duplicate advance or an already-delivered
 * shipment updates zero rows and returns null. On `delivered` it also CAS-transitions the
 * order `fulfilling → delivered` and records the order history. Returns the new status or null.
 */
export async function advanceShipment(
  db: DB,
  shipmentId: string,
  log: FastifyBaseLogger,
): Promise<ShipmentStatus | null> {
  const ordersRepo = makeOrdersRepository(db);
  const result = await db.transaction(async (tx) => {
    const [ship] = await tx.select().from(shipments).where(eq(shipments.id, shipmentId));
    if (!ship) return null;
    const from = ship.status as ShipmentStatus;
    const to = nextStatus(SHIPMENT_TRANSITIONS, from);
    if (!to) return null; // already delivered

    const advanced = await tx
      .update(shipments)
      .set({ status: to, updatedAt: new Date() })
      .where(and(eq(shipments.id, shipmentId), eq(shipments.status, from)))
      .returning({ orderId: shipments.orderId });
    if (advanced.length === 0) return null; // lost a race — someone else advanced it
    const orderId = advanced[0]!.orderId;

    const payload: ShipmentEventPayload = { orderId, shipmentId, status: to };
    await tx.insert(outboxMessages).values({
      aggregateType: 'order',
      aggregateId: orderId,
      correlationId: orderId,
      eventType: EVENT_BY_STATUS[to as AdvancedShipmentStatus],
      payload,
    });

    if (to === ShipmentStatuses.Delivered) {
      const delivered = await ordersRepo.transition(
        tx,
        orderId,
        OrderStatuses.Fulfilling,
        OrderStatuses.Delivered,
        { reason: OrderReasons.ShipmentDelivered },
      );
      if (!delivered) {
        log.warn({ orderId }, 'order not fulfilling at delivery; skipping order transition');
      }
    }
    return to;
  });
  if (result === ShipmentStatuses.Delivered) sagaMetrics.shipmentsDelivered.inc();
  return result;
}
