import type { ConsumeMessage } from 'amqplib';
import type { FastifyBaseLogger } from 'fastify';
import type { DB } from '@infra/db/client';
import { outboxMessages } from '@infra/db/schema';
import type { HandlerResult } from '@infra/mq/consumer';
import { parseEnvelope, claimOnce } from '@infra/mq/idempotent-consumer';
import { INVENTORY_CONSUMER } from '@/constants/index';
import {
  INVENTORY_RESERVED_EVENT,
  ORDER_CANCELLED_EVENT,
  type OrderCreatedPayload,
  type InventoryReservedPayload,
  type OrderCancelledPayload,
} from '@infra/mq/outbox-event-types';
import { makeInventoryRepository } from '@modules/inventory/inventory-repository';
import { makeOrdersRepository } from '@modules/orders/orders-repository';
import { OrderStatuses } from '@/types/order-status';
import { OrderReasons } from '@/types/order-reasons';
import { sagaMetrics } from '@infra/telemetry/saga-metrics';

interface HandlerDeps {
  db: DB;
  log: FastifyBaseLogger;
}

class InsufficientStockError extends Error {}

export async function reserveOnOrderCreated(
  msg: ConsumeMessage,
  { db, log }: HandlerDeps,
): Promise<HandlerResult> {
  const envelope = parseEnvelope<OrderCreatedPayload>(msg, log);
  if (!envelope) return 'ack';

  const eventId = envelope.eventId;
  const { orderId, items } = envelope.payload;
  const correlationId = envelope.correlationId || orderId;

  try {
    const ordersRepo = makeOrdersRepository(db);
    const inventoryRepo = makeInventoryRepository();
    let duplicate = false;
    let reserved = true;

    await db.transaction(async (tx) => {
      if (!(await claimOnce(tx, INVENTORY_CONSUMER, eventId))) {
        duplicate = true;
        return;
      }

      try {
        await tx.transaction(async (sp) => {
          for (const item of items) {
            const ok = await inventoryRepo.reserve(sp, item.productId, item.quantity);
            if (!ok) throw new InsufficientStockError();
          }
        });
      } catch (err) {
        if (err instanceof InsufficientStockError) reserved = false;
        else throw err;
      }

      if (reserved) {
        const payload: InventoryReservedPayload = {
          orderId,
          items: items.map((i) => ({ productId: i.productId, quantity: i.quantity })),
        };
        await tx.insert(outboxMessages).values({
          aggregateType: 'order',
          aggregateId: orderId,
          correlationId,
          eventType: INVENTORY_RESERVED_EVENT,
          payload,
        });
      } else {
        const cancelled = await ordersRepo.transition(
          tx,
          orderId,
          OrderStatuses.Pending,
          OrderStatuses.Cancelled,
          { reason: OrderReasons.OutOfStock, cancelReason: OrderReasons.OutOfStock },
        );
        if (cancelled) {
          const payload: OrderCancelledPayload = { orderId, reason: OrderReasons.OutOfStock };
          await tx.insert(outboxMessages).values({
            aggregateType: 'order',
            aggregateId: orderId,
            correlationId,
            eventType: ORDER_CANCELLED_EVENT,
            payload,
          });
        } else {
          log.warn({ orderId }, 'order not pending at reserve-cancel; skipping cancel emit');
        }
      }
    });

    if (duplicate) log.info({ eventId }, 'duplicate delivery, skipped');
    else {
      if (reserved) sagaMetrics.inventoryReserved.inc();
      else sagaMetrics.ordersCancelled.inc();
      log.info({ orderId, reserved }, reserved ? 'inventory reserved' : 'order cancelled (stock)');
    }
    return 'ack';
  } catch (err) {
    log.error({ err, eventId, orderId }, 'reserve handler failed');
    return 'retry';
  }
}
