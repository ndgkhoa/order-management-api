import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { pino } from 'pino';
import { and, eq } from 'drizzle-orm';
import type { ConsumeMessage } from 'amqplib';
import type { FastifyBaseLogger } from 'fastify';
import type { AppInstance } from '@/app.js';
import { db } from '@infra/db/client.js';
import { orders, orderItems, products, users, payments, outboxMessages } from '@infra/db/schema.js';
import { PAYMENT_FAILED_EVENT, ORDER_CANCELLED_EVENT } from '@infra/mq/outbox-event-types.js';
import { createPaymentOnReserved } from '@modules/payments/create-payment-on-reserved.js';
import { compensateOnPaymentFailed } from '@modules/payments/compensate-on-payment-failed.js';
import { signWebhook } from '@modules/payments/webhook-signature.js';
import { buildTestApp } from '@test/helpers/build-test-app.js';
import { resetDb } from '@test/helpers/reset-db.js';

const log = pino({ level: 'silent' }) as unknown as FastifyBaseLogger;
const SECRET = process.env.WEBHOOK_HMAC_SECRET!;

function envelopeMsg(eventType: string, payload: unknown): ConsumeMessage {
  const envelope = {
    eventId: crypto.randomUUID(),
    eventType,
    correlationId: (payload as { orderId: string }).orderId,
    occurredAt: new Date().toISOString(),
    payload,
  };
  return {
    content: Buffer.from(JSON.stringify(envelope)),
    properties: { messageId: envelope.eventId },
    fields: {},
  } as unknown as ConsumeMessage;
}

async function seedReservedOrder() {
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
  return { orderId: order!.id, productId: product!.id };
}

function postSignedWebhook(app: AppInstance, body: Record<string, unknown>) {
  const raw = JSON.stringify(body);
  return app.inject({
    method: 'POST',
    url: '/webhooks/payment',
    headers: { 'content-type': 'application/json', 'x-signature': signWebhook(SECRET, raw) },
    payload: raw,
  });
}

describe('payment saga — failure & compensation (reserved → failed → released/cancelled)', () => {
  let app: AppInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  beforeEach(async () => {
    await resetDb();
    await app.redis.flushdb();
  });

  it('releases inventory and cancels the order on a FAILED webhook', async () => {
    const { orderId, productId } = await seedReservedOrder();

    await createPaymentOnReserved(
      envelopeMsg('inventory.reserved', { orderId, items: [{ productId, quantity: 2 }] }),
      { db, log },
    );
    const [payment] = await db.select().from(payments).where(eq(payments.orderId, orderId));

    const res = await postSignedWebhook(app, {
      providerEventId: crypto.randomUUID(),
      paymentId: payment!.id,
      outcome: 'FAILED',
      timestamp: Date.now(),
    });
    expect(res.statusCode).toBe(200);

    const [failed] = await db.select().from(payments).where(eq(payments.id, payment!.id));
    expect(failed!.status).toBe('failed');
    const failedEvent = await db
      .select()
      .from(outboxMessages)
      .where(
        and(
          eq(outboxMessages.aggregateId, orderId),
          eq(outboxMessages.eventType, PAYMENT_FAILED_EVENT),
        ),
      );
    expect(failedEvent).toHaveLength(1);

    // payment.failed → release inventory + cancel order
    const r = await compensateOnPaymentFailed(
      envelopeMsg('payment.failed', { orderId, paymentId: payment!.id }),
      { db, log },
    );
    expect(r).toBe('ack');

    const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
    expect(order!.status).toBe('cancelled');
    const [prod] = await db.select().from(products).where(eq(products.id, productId));
    expect([prod!.stockAvailable, prod!.stockReserved]).toEqual([10, 0]); // released back
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

  it('does not revive a failed payment (cancelled → paid rejected via CAS)', async () => {
    const { orderId, productId } = await seedReservedOrder();
    await createPaymentOnReserved(
      envelopeMsg('inventory.reserved', { orderId, items: [{ productId, quantity: 2 }] }),
      { db, log },
    );
    const [payment] = await db.select().from(payments).where(eq(payments.orderId, orderId));

    // fail first
    await postSignedWebhook(app, {
      providerEventId: crypto.randomUUID(),
      paymentId: payment!.id,
      outcome: 'FAILED',
      timestamp: Date.now(),
    });

    // a later SUCCEEDED webhook with a DISTINCT event id passes dedup but must NOT flip status
    const late = await postSignedWebhook(app, {
      providerEventId: crypto.randomUUID(),
      paymentId: payment!.id,
      outcome: 'SUCCEEDED',
      timestamp: Date.now(),
    });
    expect(late.statusCode).toBe(200); // no-op, not an error

    const [still] = await db.select().from(payments).where(eq(payments.id, payment!.id));
    expect(still!.status).toBe('failed'); // CAS on `pending` rejected the revive
    const succeededEvents = await db
      .select()
      .from(outboxMessages)
      .where(
        and(
          eq(outboxMessages.aggregateId, orderId),
          eq(outboxMessages.eventType, 'payment.succeeded'),
        ),
      );
    expect(succeededEvents).toHaveLength(0);
  });
});
