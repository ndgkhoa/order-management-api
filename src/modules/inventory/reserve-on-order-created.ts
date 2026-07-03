import { and, eq } from 'drizzle-orm';
import type { ConsumeMessage } from 'amqplib';
import type { FastifyBaseLogger } from 'fastify';
import type { DB } from '@infra/db/client.js';
import { orders, outboxMessages, processedMessages } from '@infra/db/schema.js';
import type { HandlerResult } from '@infra/mq/consumer.js';
import type { EventEnvelope } from '@infra/mq/event-envelope.js';
import {
  INVENTORY_RESERVED_EVENT,
  ORDER_CANCELLED_EVENT,
  type OrderCreatedPayload,
  type InventoryReservedPayload,
  type OrderCancelledPayload,
} from '@infra/mq/outbox-event-types.js';
import { reserveStock } from '@modules/inventory/adjust-stock.js';
import { recordOrderTransition } from '@modules/orders/order-status-history.js';

interface HandlerDeps {
  db: DB;
  log: FastifyBaseLogger;
}

/** This consumer's identity in the per-consumer dedupe key (distinct from 'email'). */
const CONSUMER_NAME = 'inventory';
const OUT_OF_STOCK = 'out_of_stock';

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
  let envelope: EventEnvelope<OrderCreatedPayload>;
  try {
    envelope = JSON.parse(msg.content.toString()) as EventEnvelope<OrderCreatedPayload>;
  } catch (err) {
    log.error({ err }, 'malformed message body; dropping to avoid poison loop');
    return 'ack';
  }

  const eventId = envelope.eventId;
  if (!eventId) {
    log.error('message missing eventId; dropping to avoid poison loop');
    return 'ack';
  }

  const { orderId, items } = envelope.payload;
  const correlationId = envelope.correlationId || orderId;

  try {
    let duplicate = false;
    let reserved = true;

    await db.transaction(async (tx) => {
      const inserted = await tx
        .insert(processedMessages)
        .values({ consumerName: CONSUMER_NAME, eventId })
        .onConflictDoNothing()
        .returning();
      if (inserted.length === 0) {
        duplicate = true; // already processed → don't reserve again
        return;
      }

      // Savepoint: any short line throws → the whole reserve rolls back (no partial hold).
      try {
        await tx.transaction(async (sp) => {
          for (const item of items) {
            const ok = await reserveStock(sp, item.productId, item.quantity);
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
        const cancelledRows = await tx
          .update(orders)
          .set({ status: 'cancelled', cancelReason: OUT_OF_STOCK, updatedAt: new Date() })
          .where(and(eq(orders.id, orderId), eq(orders.status, 'pending')))
          .returning({ id: orders.id });
        if (cancelledRows.length > 0) {
          await recordOrderTransition(tx, {
            orderId,
            from: 'pending',
            to: 'cancelled',
            reason: OUT_OF_STOCK,
          });
          const payload: OrderCancelledPayload = { orderId, reason: OUT_OF_STOCK };
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
    else
      log.info({ orderId, reserved }, reserved ? 'inventory reserved' : 'order cancelled (stock)');
    return 'ack';
  } catch (err) {
    log.error({ err, eventId, orderId }, 'reserve handler failed');
    return 'retry';
  }
}
