import type { ConsumeMessage } from 'amqplib';
import type { FastifyBaseLogger } from 'fastify';
import type { DB } from '@infra/db/client';
import type { HandlerResult } from '@infra/mq/consumer';
import { createShipmentOnOrderPaid } from '@/sagas/create-shipment-on-order-paid';
import { makeShipmentsRepository } from '@modules/shipping/shipments-repository';
import { ShipmentStatuses } from '@/types/shipment-status';

export interface ShippingConfig {
  stepMs: number;
}

interface ConsumerDeps {
  db: DB;
  config: ShippingConfig;
  log: FastifyBaseLogger;
}

function scheduleAdvances(
  db: DB,
  shipmentId: string,
  config: ShippingConfig,
  log: FastifyBaseLogger,
): void {
  const shipmentsRepo = makeShipmentsRepository(db);
  const tick = (): void => {
    setTimeout(() => {
      void shipmentsRepo.advance(shipmentId, log).then((next) => {
        if (next && next !== ShipmentStatuses.Delivered) tick();
      });
    }, config.stepMs);
  };
  tick();
}

export function makeShippingConsumer({ db, config, log }: ConsumerDeps) {
  return async (msg: ConsumeMessage): Promise<HandlerResult> => {
    const { result, shipmentId } = await createShipmentOnOrderPaid(msg, { db, log });
    if (result === 'ack' && shipmentId) scheduleAdvances(db, shipmentId, config, log);
    return result;
  };
}
