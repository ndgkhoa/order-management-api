import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { pino } from 'pino';
import { eq } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type { AppInstance } from '@/app.js';
import { db } from '@infra/db/client.js';
import { orders, products, payments, outboxMessages } from '@infra/db/schema.js';
import { reserveOnOrderCreated } from '@/sagas/reserve-on-order-created.js';
import { createPaymentOnReserved } from '@/sagas/create-payment-on-reserved.js';
import { compensateOnPaymentFailed } from '@/sagas/compensate-on-payment-failed.js';
import { signWebhook } from '@infra/http/webhook-signature.js';
import { buildTestApp, registerAndLogin } from '@test/helpers/build-test-app.js';
import { resetDb } from '@test/helpers/reset-db.js';
import { outboxMsg } from '@test/helpers/envelope.js';
import { counterValue } from '@test/helpers/metric-value.js';

const log = pino({ level: 'silent' }) as unknown as FastifyBaseLogger;
const SECRET = process.env.WEBHOOK_HMAC_SECRET!;

describe('compensation (forced payment failure)', () => {
  let app: AppInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  beforeEach(async () => {
    await resetDb();
    await app.redis.flushdb();
  });

  it('releases inventory and cancels the order when payment fails', async () => {
    const before = {
      failed: await counterValue('saga_payments_failed_total'),
      cancelled: await counterValue('saga_orders_cancelled_total'),
    };

    const { token } = await registerAndLogin(app);
    const [product] = await db
      .insert(products)
      .values({ sku: `SKU-${crypto.randomUUID()}`, name: 'p', priceCents: 100, stockAvailable: 10 })
      .returning();

    const created = await app
      .inject({
        method: 'POST',
        url: '/orders',
        headers: { authorization: `Bearer ${token}` },
        payload: { items: [{ productId: product!.id, quantity: 2 }] },
      })
      .then((r) => r.json<{ id: string }>());
    const orderId = created.id;

    await reserveOnOrderCreated(await outboxMsg(orderId, 'order.created'), { db, log });
    await createPaymentOnReserved(await outboxMsg(orderId, 'inventory.reserved'), { db, log });

    const [held] = await db.select().from(products).where(eq(products.id, product!.id));
    expect([held!.stockAvailable, held!.stockReserved]).toEqual([8, 2]);

    const [payment] = await db.select().from(payments).where(eq(payments.orderId, orderId));
    const raw = JSON.stringify({
      providerEventId: crypto.randomUUID(),
      paymentId: payment!.id,
      outcome: 'FAILED',
      timestamp: Date.now(),
    });
    const webhook = await app.inject({
      method: 'POST',
      url: '/webhooks/payment',
      headers: { 'content-type': 'application/json', 'x-signature': signWebhook(SECRET, raw) },
      payload: raw,
    });
    expect(webhook.statusCode).toBe(200);

    await compensateOnPaymentFailed(await outboxMsg(orderId, 'payment.failed'), { db, log });

    const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
    expect(order!.status).toBe('cancelled');
    const [paid] = await db.select().from(payments).where(eq(payments.orderId, orderId));
    expect(paid!.status).toBe('failed');
    const [prod] = await db.select().from(products).where(eq(products.id, product!.id));
    expect([prod!.stockAvailable, prod!.stockReserved]).toEqual([10, 0]);

    const events = await db
      .select()
      .from(outboxMessages)
      .where(eq(outboxMessages.aggregateId, orderId));
    expect(events.length).toBeGreaterThanOrEqual(4);
    for (const e of events) expect(e.correlationId).toBe(orderId);

    expect(await counterValue('saga_payments_failed_total')).toBe(before.failed + 1);
    expect(await counterValue('saga_orders_cancelled_total')).toBe(before.cancelled + 1);
  });
});
