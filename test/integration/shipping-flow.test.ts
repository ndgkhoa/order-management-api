import { describe, it, expect, beforeEach } from 'vitest';
import { pino } from 'pino';
import { and, eq } from 'drizzle-orm';
import type { ConsumeMessage } from 'amqplib';
import type { FastifyBaseLogger } from 'fastify';
import { db } from '@infra/db/client.js';
import {
  users,
  orders,
  orderItems,
  products,
  shipments,
  outboxMessages,
  orderStatusHistory,
} from '@infra/db/schema.js';
import { SHIPMENT_CREATED_EVENT, SHIPMENT_DELIVERED_EVENT } from '@infra/mq/outbox-event-types.js';
import { createShipmentOnOrderPaid } from '@modules/shipping/create-shipment-on-order-paid.js';
import { advanceShipment } from '@modules/shipping/advance-shipment.js';
import { resetDb } from '@test/helpers/reset-db.js';

const log = pino({ level: 'silent' }) as unknown as FastifyBaseLogger;

function orderPaidMsg(orderId: string): ConsumeMessage {
  const envelope = {
    eventId: crypto.randomUUID(),
    eventType: 'order.paid',
    correlationId: orderId,
    occurredAt: new Date().toISOString(),
    payload: { orderId, paymentId: crypto.randomUUID() },
  };
  return {
    content: Buffer.from(JSON.stringify(envelope)),
    properties: { messageId: envelope.eventId },
    fields: {},
  } as unknown as ConsumeMessage;
}

/** Seeds a PAID order (reservation already committed: reserved=0) + one line. */
async function seedPaidOrder() {
  const [u] = await db
    .insert(users)
    .values({ email: `u-${crypto.randomUUID()}@t.dev`, passwordHash: 'x' })
    .returning();
  const [product] = await db
    .insert(products)
    .values({ sku: `SKU-${crypto.randomUUID()}`, name: 'p', priceCents: 100, stockAvailable: 8 })
    .returning();
  const [order] = await db
    .insert(orders)
    .values({ userId: u!.id, totalCents: 200, status: 'paid' })
    .returning();
  await db.insert(orderItems).values({
    orderId: order!.id,
    productId: product!.id,
    skuSnapshot: product!.sku,
    unitPriceCents: 100,
    quantity: 2,
    lineTotalCents: 200,
  });
  return order!.id;
}

describe('shipping flow (order.paid → delivered)', () => {
  beforeEach(resetDb);

  it('creates a shipment, advances it to delivered, and records order history', async () => {
    const orderId = await seedPaidOrder();

    const { result, shipmentId } = await createShipmentOnOrderPaid(orderPaidMsg(orderId), {
      db,
      log,
    });
    expect(result).toBe('ack');
    expect(shipmentId).toBeDefined();

    let [ship] = await db.select().from(shipments).where(eq(shipments.orderId, orderId));
    expect(ship!.status).toBe('pending');
    let [order] = await db.select().from(orders).where(eq(orders.id, orderId));
    expect(order!.status).toBe('fulfilling'); // paid → fulfilling on shipment creation
    const created = await db
      .select()
      .from(outboxMessages)
      .where(
        and(
          eq(outboxMessages.aggregateId, orderId),
          eq(outboxMessages.eventType, SHIPMENT_CREATED_EVENT),
        ),
      );
    expect(created).toHaveLength(1);

    // advance through the three steps
    expect(await advanceShipment(db, shipmentId!, log)).toBe('ready_for_pickup');
    expect(await advanceShipment(db, shipmentId!, log)).toBe('in_transit');
    expect(await advanceShipment(db, shipmentId!, log)).toBe('delivered');
    // past the end → no-op
    expect(await advanceShipment(db, shipmentId!, log)).toBeNull();

    [ship] = await db.select().from(shipments).where(eq(shipments.orderId, orderId));
    expect(ship!.status).toBe('delivered');
    [order] = await db.select().from(orders).where(eq(orders.id, orderId));
    expect(order!.status).toBe('delivered');

    const delivered = await db
      .select()
      .from(outboxMessages)
      .where(
        and(
          eq(outboxMessages.aggregateId, orderId),
          eq(outboxMessages.eventType, SHIPMENT_DELIVERED_EVENT),
        ),
      );
    expect(delivered).toHaveLength(1);

    // history captured both order transitions
    const history = await db
      .select()
      .from(orderStatusHistory)
      .where(eq(orderStatusHistory.orderId, orderId));
    const pairs = history.map((h) => `${h.fromStatus}->${h.toStatus}`);
    expect(pairs).toContain('paid->fulfilling');
    expect(pairs).toContain('fulfilling->delivered');
  });
});
