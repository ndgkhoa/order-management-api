import type { ConsumeMessage } from 'amqplib';
import type { FastifyBaseLogger } from 'fastify';
import type { DB } from '@infra/db/client.js';
import type { HandlerResult } from '@infra/mq/consumer.js';
import { createShipmentOnOrderPaid } from '@modules/shipping/sagas/create-shipment-on-order-paid.js';
import { advanceShipment } from '@modules/shipping/advance-shipment.js';
import { ShipmentStatuses } from '@/domain/shipment-status.js';

export interface ShippingConfig {
  stepMs: number;
}

interface ConsumerDeps {
  db: DB;
  config: ShippingConfig;
  log: FastifyBaseLogger;
}

/**
 * Fake carrier: after creating the shipment, drives it to delivered by advancing one step
 * every `stepMs` via an in-process timer chain. The timer is non-durable (lost on restart —
 * the order would sit in `fulfilling` until an admin manually advances it via
 * `PATCH /shipments/:id/status`); acceptable for a mock, a real carrier sends async updates.
 */
function scheduleAdvances(
  db: DB,
  shipmentId: string,
  config: ShippingConfig,
  log: FastifyBaseLogger,
): void {
  const tick = (): void => {
    setTimeout(() => {
      void advanceShipment(db, shipmentId, log).then((next) => {
        if (next && next !== ShipmentStatuses.Delivered) tick();
      });
    }, config.stepMs);
  };
  tick();
}

/** Builds the `order.paid` consumer: create the shipment, then kick off the timed advances. */
export function makeShippingConsumer({ db, config, log }: ConsumerDeps) {
  return async (msg: ConsumeMessage): Promise<HandlerResult> => {
    const { result, shipmentId } = await createShipmentOnOrderPaid(msg, { db, log });
    if (result === 'ack' && shipmentId) scheduleAdvances(db, shipmentId, config, log);
    return result;
  };
}
