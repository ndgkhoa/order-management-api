import type { ConsumeMessage } from 'amqplib';
import type { FastifyBaseLogger } from 'fastify';
import type { DB } from '@infra/db/client.js';
import { outboxMessages } from '@infra/db/schema.js';
import type { HandlerResult } from '@infra/mq/consumer.js';
import { parseEnvelope, claimOnce } from '@infra/mq/idempotent-consumer.js';
import { INVENTORY_CONSUMER } from '@/constants/index.js';
import {
  INVENTORY_RESERVED_EVENT,
  ORDER_CANCELLED_EVENT,
  type OrderCreatedPayload,
  type InventoryReservedPayload,
  type OrderCancelledPayload,
} from '@infra/mq/outbox-event-types.js';
import { makeInventoryRepository } from '@modules/inventory/inventory-repository.js';
import { makeOrdersRepository } from '@modules/orders/orders-repository.js';
import { OrderStatuses } from '@/types/order-status.js';
import { OrderReasons } from '@/types/order-reasons.js';
import { sagaMetrics } from '@infra/telemetry/saga-metrics.js';

interface HandlerDeps {
  db: DB;
  log: FastifyBaseLogger;
}

/** This consumer's identity in the per-consumer dedupe key (distinct from 'email'). */

/** Thrown inside the reserve savepoint so a single insufficient line rolls back ALL reserves. */
class InsufficientStockError extends Error {}

/**
 * `order.created` → reserve stock for every line. In ONE db transaction, keyed idempotent by
 * (consumer='inventory', eventId): reserve each item with a guarded atomic UPDATE inside a
 * savepoint. If ALL succeed → commit + emit `inventory.reserved`. If ANY line is short → the
 * savepoint rolls back the partial reserves (all-or-nothing), the order is cancelled
 * (out_of_stock, compare-and-set on `pending`), and `order.cancelled` is emitted. Both the
 * next event and the state change commit together (transactional outbox).
 */
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
        duplicate = true; // already processed → don't reserve again
        return;
      }

      // Savepoint: any short line throws → the whole reserve rolls back (no partial hold).
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
        // Compare-and-set: only cancel an order still pending. Emit order.cancelled ONLY if
        // this update actually transitioned a row — so a redelivery or an already-terminal
        // order (future pay/cancel race) never produces a spurious cancellation event.
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
