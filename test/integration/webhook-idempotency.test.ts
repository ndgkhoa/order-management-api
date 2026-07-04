import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { pino } from 'pino';
import { and, eq } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type { AppInstance } from '@/app.js';
import { db } from '@infra/db/client.js';
import { orders, orderItems, products, users, payments, outboxMessages } from '@infra/db/schema.js';
import { PAYMENT_SUCCEEDED_EVENT } from '@infra/mq/outbox-event-types.js';
import { createPaymentOnReserved } from '@/sagas/create-payment-on-reserved.js';
import { signWebhook } from '@infra/http/webhook-signature.js';
import { buildTestApp } from '@test/helpers/build-test-app.js';
import { resetDb } from '@test/helpers/reset-db.js';
import { envelopeMsg } from '@test/helpers/envelope.js';

const log = pino({ level: 'silent' }) as unknown as FastifyBaseLogger;
const SECRET = process.env.WEBHOOK_HMAC_SECRET!;

async function seedPayment() {
  const [u] = await db
    .insert(users)
    .values({ email: `u-${crypto.randomUUID()}@t.dev`, passwordHash: 'x' })
    .returning();
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
  await createPaymentOnReserved(
    envelopeMsg('inventory.reserved', {
      orderId: order!.id,
      items: [{ productId: product!.id, quantity: 2 }],
    }),
    { db, log },
  );
  const [payment] = await db.select().from(payments).where(eq(payments.orderId, order!.id));
  return { orderId: order!.id, paymentId: payment!.id };
}

describe('payment webhook — signature gate + idempotency', () => {
  let app: AppInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  beforeEach(async () => {
    await resetDb();
    await app.redis.flushdb();
  });

  it('applies a duplicated webhook (same event id) exactly once', async () => {
    const { orderId, paymentId } = await seedPayment();
    const raw = JSON.stringify({
      providerEventId: crypto.randomUUID(),
      paymentId,
      outcome: 'SUCCEEDED',
      timestamp: Date.now(),
    });
    const headers = { 'content-type': 'application/json', 'x-signature': signWebhook(SECRET, raw) };

    // deliver the SAME signed webhook three times
    for (let i = 0; i < 3; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/webhooks/payment',
        headers,
        payload: raw,
      });
      expect(res.statusCode).toBe(200);
    }

    const [payment] = await db.select().from(payments).where(eq(payments.id, paymentId));
    expect(payment!.status).toBe('paid'); // applied once, still paid (not double-processed)
    const emitted = await db
      .select()
      .from(outboxMessages)
      .where(
        and(
          eq(outboxMessages.aggregateId, orderId),
          eq(outboxMessages.eventType, PAYMENT_SUCCEEDED_EVENT),
        ),
      );
    expect(emitted).toHaveLength(1); // exactly one downstream event
  });

  it('rejects a bad signature with 401 before any side effect', async () => {
    const { paymentId } = await seedPayment();
    const raw = JSON.stringify({
      providerEventId: crypto.randomUUID(),
      paymentId,
      outcome: 'SUCCEEDED',
      timestamp: Date.now(),
    });

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/payment',
      headers: { 'content-type': 'application/json', 'x-signature': 'deadbeef' },
      payload: raw,
    });
    expect(res.statusCode).toBe(401);

    const [payment] = await db.select().from(payments).where(eq(payments.id, paymentId));
    expect(payment!.status).toBe('pending'); // untouched
  });

  it('rejects a stale timestamp with 401 (replay defense)', async () => {
    const { paymentId } = await seedPayment();
    const raw = JSON.stringify({
      providerEventId: crypto.randomUUID(),
      paymentId,
      outcome: 'SUCCEEDED',
      timestamp: Date.now() - 60 * 60 * 1000, // 1h old
    });

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/payment',
      headers: { 'content-type': 'application/json', 'x-signature': signWebhook(SECRET, raw) },
      payload: raw,
    });
    expect(res.statusCode).toBe(401);
    const [payment] = await db.select().from(payments).where(eq(payments.id, paymentId));
    expect(payment!.status).toBe('pending');
  });
});
