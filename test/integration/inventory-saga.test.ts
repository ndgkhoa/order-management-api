import { describe, it, expect, beforeEach } from 'vitest';
import { pino } from 'pino';
import { and, eq } from 'drizzle-orm';
import type { ConsumeMessage } from 'amqplib';
import type { FastifyBaseLogger } from 'fastify';
import { db } from '@infra/db/client.js';
import {
  orders,
  orderItems,
  products,
  users,
  outboxMessages,
  processedMessages,
} from '@infra/db/schema.js';
import {
  INVENTORY_RESERVED_EVENT,
  ORDER_CANCELLED_EVENT,
  type OrderCreatedPayload,
} from '@infra/mq/outbox-event-types.js';
import { reserveOnOrderCreated } from '@/sagas/reserve-on-order-created.js';
import { resetDb } from '@test/helpers/reset-db.js';

const log = pino({ level: 'silent' }) as unknown as FastifyBaseLogger;

async function seedProduct(available: number) {
  const [row] = await db
    .insert(products)
    .values({
      sku: `SKU-${crypto.randomUUID()}`,
      name: 'p',
      priceCents: 100,
      stockAvailable: available,
    })
    .returning();
  return row!;
}

async function seedOrder(userId: string, lines: { productId: string; quantity: number }[]) {
  const [order] = await db.insert(orders).values({ userId, totalCents: 100 }).returning();
  await db.insert(orderItems).values(
    lines.map((l) => ({
      orderId: order!.id,
      productId: l.productId,
      skuSnapshot: 'SKU',
      unitPriceCents: 100,
      quantity: l.quantity,
      lineTotalCents: 100 * l.quantity,
    })),
  );
  return order!.id;
}

async function seedUser() {
  const [u] = await db
    .insert(users)
    .values({ email: `u-${crypto.randomUUID()}@t.dev`, passwordHash: 'x' })
    .returning();
  return u!.id;
}

function orderCreatedMsg(eventId: string, payload: OrderCreatedPayload): ConsumeMessage {
  const envelope = {
    eventId,
    eventType: 'order.created',
    correlationId: payload.orderId,
    occurredAt: new Date().toISOString(),
    payload,
  };
  return {
    content: Buffer.from(JSON.stringify(envelope)),
    properties: { messageId: eventId },
    fields: {},
  } as unknown as ConsumeMessage;
}

const item = (productId: string, quantity: number) => ({
  productId,
  sku: 'SKU',
  unitPriceCents: 100,
  quantity,
});

describe('inventory reservation saga', () => {
  beforeEach(resetDb);

  it('reserves stock and emits inventory.reserved on success; order stays pending', async () => {
    const userId = await seedUser();
    const a = await seedProduct(10);
    const b = await seedProduct(5);
    const orderId = await seedOrder(userId, [
      { productId: a.id, quantity: 2 },
      { productId: b.id, quantity: 3 },
    ]);
    const payload: OrderCreatedPayload = {
      orderId,
      userId,
      items: [item(a.id, 2), item(b.id, 3)],
      totalCents: 500,
    };

    const result = await reserveOnOrderCreated(orderCreatedMsg(crypto.randomUUID(), payload), {
      db,
      log,
    });
    expect(result).toBe('ack');

    const [pa] = await db.select().from(products).where(eq(products.id, a.id));
    const [pb] = await db.select().from(products).where(eq(products.id, b.id));
    expect([pa!.stockAvailable, pa!.stockReserved]).toEqual([8, 2]);
    expect([pb!.stockAvailable, pb!.stockReserved]).toEqual([2, 3]);

    const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
    expect(order!.status).toBe('pending');

    const emitted = await db
      .select()
      .from(outboxMessages)
      .where(
        and(
          eq(outboxMessages.aggregateId, orderId),
          eq(outboxMessages.eventType, INVENTORY_RESERVED_EVENT),
        ),
      );
    expect(emitted).toHaveLength(1);
  });

  it('cancels the order (out_of_stock) and reserves nothing when any line is short', async () => {
    const userId = await seedUser();
    const a = await seedProduct(10);
    const b = await seedProduct(1);
    const orderId = await seedOrder(userId, [
      { productId: a.id, quantity: 2 },
      { productId: b.id, quantity: 3 },
    ]);
    const payload: OrderCreatedPayload = {
      orderId,
      userId,
      items: [item(a.id, 2), item(b.id, 3)],
      totalCents: 500,
    };

    const result = await reserveOnOrderCreated(orderCreatedMsg(crypto.randomUUID(), payload), {
      db,
      log,
    });
    expect(result).toBe('ack');

    const [pa] = await db.select().from(products).where(eq(products.id, a.id));
    expect([pa!.stockAvailable, pa!.stockReserved]).toEqual([10, 0]);

    const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
    expect(order!.status).toBe('cancelled');
    expect(order!.cancelReason).toBe('out_of_stock');

    const cancelled = await db
      .select()
      .from(outboxMessages)
      .where(
        and(
          eq(outboxMessages.aggregateId, orderId),
          eq(outboxMessages.eventType, ORDER_CANCELLED_EVENT),
        ),
      );
    expect(cancelled).toHaveLength(1);
  });

  it('is idempotent: redelivering the same eventId reserves once', async () => {
    const userId = await seedUser();
    const a = await seedProduct(10);
    const orderId = await seedOrder(userId, [{ productId: a.id, quantity: 2 }]);
    const payload: OrderCreatedPayload = {
      orderId,
      userId,
      items: [item(a.id, 2)],
      totalCents: 200,
    };
    const eventId = crypto.randomUUID();

    await reserveOnOrderCreated(orderCreatedMsg(eventId, payload), { db, log });
    await reserveOnOrderCreated(orderCreatedMsg(eventId, payload), { db, log });

    const [pa] = await db.select().from(products).where(eq(products.id, a.id));
    expect([pa!.stockAvailable, pa!.stockReserved]).toEqual([8, 2]);

    const dedupe = await db
      .select()
      .from(processedMessages)
      .where(eq(processedMessages.eventId, eventId));
    expect(dedupe).toHaveLength(1);
    expect(dedupe[0]!.consumerName).toBe('inventory');
  });
});
