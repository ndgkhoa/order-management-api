import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { pino } from 'pino';
import { and, eq } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type { AppInstance } from '@/app.js';
import { db } from '@infra/db/client.js';
import { orders, orderItems, products, users, payments, outboxMessages } from '@infra/db/schema.js';
import {
  PAYMENT_CREATED_EVENT,
  PAYMENT_SUCCEEDED_EVENT,
  ORDER_PAID_EVENT,
} from '@infra/mq/outbox-event-types.js';
import { createPaymentOnReserved } from '@/sagas/create-payment-on-reserved.js';
import { completeOnPaymentSucceeded } from '@/sagas/complete-on-payment-succeeded.js';
import { buildTestApp } from '@test/helpers/build-test-app.js';
import { resetDb } from '@test/helpers/reset-db.js';
import { envelopeMsg, postSignedWebhook } from '@test/helpers/envelope.js';

const log = pino({ level: 'silent' }) as unknown as FastifyBaseLogger;

/** Seeds a user + a reserved product + a pending order and returns the ids/quantities. */
async function seedReservedOrder() {
  const [u] = await db
    .insert(users)
    .values({ email: `u-${crypto.randomUUID()}@t.dev`, passwordHash: 'x' })
    .returning();
  // post-reserve state: available already decremented, 2 units held in reserved
  const [product] = await db
    .insert(products)
    .values({
      sku: `SKU-${crypto.randomUUID()}`,
      name: 'p',
      priceCents: 100,
      stockAvailable: 8,
      stockReserved: 2,
    })
    .returning();
  const [order] = await db.insert(orders).values({ userId: u!.id, totalCents: 200 }).returning();
  await db.insert(orderItems).values({
    orderId: order!.id,
    productId: product!.id,
    skuSnapshot: product!.sku,
    unitPriceCents: 100,
    quantity: 2,
    lineTotalCents: 200,
  });
  return { orderId: order!.id, productId: product!.id };
}

describe('payment saga — happy path (reserved → paid → OrderPaid)', () => {
  let app: AppInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  beforeEach(async () => {
    await resetDb();
    await app.redis.flushdb();
  });

  it('creates a payment, settles it via a signed webhook, and commits the reservation', async () => {
    const { orderId, productId } = await seedReservedOrder();

    // inventory.reserved → payment(pending) + payment.created
    const r1 = await createPaymentOnReserved(
      envelopeMsg('inventory.reserved', { orderId, items: [{ productId, quantity: 2 }] }),
      { db, log },
    );
    expect(r1).toBe('ack');

    const [payment] = await db.select().from(payments).where(eq(payments.orderId, orderId));
    expect(payment!.status).toBe('pending');
    expect(payment!.amountCents).toBe(200);
    const created = await db
      .select()
      .from(outboxMessages)
      .where(
        and(
          eq(outboxMessages.aggregateId, orderId),
          eq(outboxMessages.eventType, PAYMENT_CREATED_EVENT),
        ),
      );
    expect(created).toHaveLength(1);

    // provider → signed webhook SUCCEEDED
    const res = await postSignedWebhook(app, {
      providerEventId: crypto.randomUUID(),
      paymentId: payment!.id,
      outcome: 'SUCCEEDED',
      timestamp: Date.now(),
    });
    expect(res.statusCode).toBe(200);

    const [paid] = await db.select().from(payments).where(eq(payments.id, payment!.id));
    expect(paid!.status).toBe('paid');
    const succeeded = await db
      .select()
      .from(outboxMessages)
      .where(
        and(
          eq(outboxMessages.aggregateId, orderId),
          eq(outboxMessages.eventType, PAYMENT_SUCCEEDED_EVENT),
        ),
      );
    expect(succeeded).toHaveLength(1);

    // payment.succeeded → order paid + reservation committed + OrderPaid
    const r2 = await completeOnPaymentSucceeded(
      envelopeMsg('payment.succeeded', { orderId, paymentId: payment!.id }),
      { db, log },
    );
    expect(r2).toBe('ack');

    const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
    expect(order!.status).toBe('paid');
    const [prod] = await db.select().from(products).where(eq(products.id, productId));
    expect([prod!.stockAvailable, prod!.stockReserved]).toEqual([8, 0]); // committed: reserved→0
    const paidEvent = await db
      .select()
      .from(outboxMessages)
      .where(
        and(
          eq(outboxMessages.aggregateId, orderId),
          eq(outboxMessages.eventType, ORDER_PAID_EVENT),
        ),
      );
    expect(paidEvent).toHaveLength(1);
  });
});
