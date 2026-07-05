import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import type { AppInstance } from '@/app.js';
import { db } from '@infra/db/client.js';
import { users, orders, orderItems, products, payments, outboxMessages } from '@infra/db/schema.js';
import { ORDER_REFUNDED_EVENT, ORDER_CANCELLED_EVENT } from '@infra/mq/outbox-event-types.js';
import type { OrderStatus } from '@/types/order-status.js';
import { buildTestApp, registerAndLogin } from '@test/helpers/build-test-app.js';
import { resetDb } from '@test/helpers/reset-db.js';

async function userIdFor(email: string): Promise<string> {
  const [u] = await db.select().from(users).where(eq(users.email, email));
  return u!.id;
}

async function seedProduct(available: number, reserved: number): Promise<string> {
  const [p] = await db
    .insert(products)
    .values({
      sku: `SKU-${crypto.randomUUID()}`,
      name: 'p',
      priceCents: 100,
      stockAvailable: available,
      stockReserved: reserved,
    })
    .returning();
  return p!.id;
}

async function seedOrder(userId: string, productId: string, status: OrderStatus): Promise<string> {
  const [order] = await db.insert(orders).values({ userId, totalCents: 200, status }).returning();
  await db.insert(orderItems).values({
    orderId: order!.id,
    productId,
    skuSnapshot: 'SKU',
    unitPriceCents: 100,
    quantity: 2,
    lineTotalCents: 200,
  });
  return order!.id;
}

function cancel(app: AppInstance, orderId: string, token: string) {
  return app.inject({
    method: 'POST',
    url: `/orders/${orderId}/cancel`,
    headers: { authorization: `Bearer ${token}` },
  });
}

describe('order cancel/refund', () => {
  let app: AppInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  beforeEach(async () => {
    await resetDb();
    await app.redis.flushdb();
  });

  it('refunds and restocks a paid order cancelled pre-ship', async () => {
    const { token, email } = await registerAndLogin(app);
    const userId = await userIdFor(email);
    const productId = await seedProduct(8, 0);
    const orderId = await seedOrder(userId, productId, 'paid');
    await db.insert(payments).values({ orderId, amountCents: 200, status: 'paid' });

    const res = await cancel(app, orderId, token);
    expect(res.statusCode).toBe(200);

    const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
    expect(order!.status).toBe('cancelled');
    const [payment] = await db.select().from(payments).where(eq(payments.orderId, orderId));
    expect(payment!.status).toBe('refunded');
    const [prod] = await db.select().from(products).where(eq(products.id, productId));
    expect(prod!.stockAvailable).toBe(10);
    const refunded = await db
      .select()
      .from(outboxMessages)
      .where(eq(outboxMessages.eventType, ORDER_REFUNDED_EVENT));
    expect(refunded).toHaveLength(1);
  });

  it('releases the reservation when a pending order is cancelled', async () => {
    const { token, email } = await registerAndLogin(app);
    const userId = await userIdFor(email);
    const productId = await seedProduct(8, 2);
    const orderId = await seedOrder(userId, productId, 'pending');

    const res = await cancel(app, orderId, token);
    expect(res.statusCode).toBe(200);

    const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
    expect(order!.status).toBe('cancelled');
    const [prod] = await db.select().from(products).where(eq(products.id, productId));
    expect([prod!.stockAvailable, prod!.stockReserved]).toEqual([10, 0]);
    const cancelled = await db
      .select()
      .from(outboxMessages)
      .where(eq(outboxMessages.eventType, ORDER_CANCELLED_EVENT));
    expect(cancelled).toHaveLength(1);
  });

  it('rejects cancelling an order already in fulfilment (409)', async () => {
    const { token, email } = await registerAndLogin(app);
    const userId = await userIdFor(email);
    const productId = await seedProduct(8, 0);
    const orderId = await seedOrder(userId, productId, 'fulfilling');

    const res = await cancel(app, orderId, token);
    expect(res.statusCode).toBe(409);
    const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
    expect(order!.status).toBe('fulfilling');
  });

  it('does not let another user cancel an order they do not own (404, IDOR)', async () => {
    const { email } = await registerAndLogin(app);
    const ownerId = await userIdFor(email);
    const productId = await seedProduct(8, 0);
    const orderId = await seedOrder(ownerId, productId, 'paid');
    await db.insert(payments).values({ orderId, amountCents: 200, status: 'paid' });

    const { token: attackerToken } = await registerAndLogin(app);
    const res = await cancel(app, orderId, attackerToken);
    expect(res.statusCode).toBe(404);

    const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
    expect(order!.status).toBe('paid');
  });
});
