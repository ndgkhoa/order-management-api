import { and, eq } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type { DB } from '@infra/db/client';
import { shipments, outboxMessages } from '@infra/db/schema';
import {
  SHIPMENT_READY_EVENT,
  SHIPMENT_IN_TRANSIT_EVENT,
  SHIPMENT_DELIVERED_EVENT,
  type ShipmentEventPayload,
} from '@infra/mq/outbox-event-types';
import { makeOrdersRepository } from '@modules/orders/orders-repository';
import { OrderStatuses } from '@/types/order-status';
import {
  ShipmentStatuses,
  SHIPMENT_TRANSITIONS,
  type ShipmentStatus,
  type AdvancedShipmentStatus,
} from '@/types/shipment-status';
import { nextStatus } from '@/utils/state-machine';
import { OrderReasons } from '@/types/order-reasons';
import { sagaMetrics } from '@infra/telemetry/saga-metrics';

const EVENT_BY_STATUS: Record<Exclude<ShipmentStatus, 'pending'>, string> = {
  ready_for_pickup: SHIPMENT_READY_EVENT,
  in_transit: SHIPMENT_IN_TRANSIT_EVENT,
  delivered: SHIPMENT_DELIVERED_EVENT,
};

export function makeShipmentsRepository(db: DB) {
  return {
    async findById(id: string) {
      return db.query.shipments.findFirst({ where: eq(shipments.id, id) });
    },

    async advance(shipmentId: string, log?: FastifyBaseLogger): Promise<ShipmentStatus | null> {
      const ordersRepo = makeOrdersRepository(db);
      const result = await db.transaction(async (tx) => {
        const [ship] = await tx.select().from(shipments).where(eq(shipments.id, shipmentId));
        if (!ship) return null;
        const from = ship.status as ShipmentStatus;
        const to = nextStatus(SHIPMENT_TRANSITIONS, from);
        if (!to) return null;

        const advanced = await tx
          .update(shipments)
          .set({ status: to, updatedAt: new Date() })
          .where(and(eq(shipments.id, shipmentId), eq(shipments.status, from)))
          .returning({ orderId: shipments.orderId });
        if (advanced.length === 0) return null;
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
            log?.warn({ orderId }, 'order not fulfilling at delivery; skipping order transition');
          }
        }
        return to;
      });
      if (result === ShipmentStatuses.Delivered) sagaMetrics.shipmentsDelivered.inc();
      return result;
    },
  };
}

export type ShipmentsRepository = ReturnType<typeof makeShipmentsRepository>;
