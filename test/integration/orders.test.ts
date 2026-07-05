import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import type { AppInstance } from '@/app.js';
import { db } from '@infra/db/client.js';
import { orderItems, outboxMessages, products } from '@infra/db/schema.js';
import { ORDER_CREATED_EVENT } from '@infra/mq/outbox-event-types.js';
import { buildTestApp, registerAndLogin } from '@test/helpers/build-test-app.js';
import { resetDb } from '@test/helpers/reset-db.js';

async function seedProduct(sku: string, priceCents: number, active = true) {
  const [row] = await db
    .insert(products)
    .values({ sku, name: sku, priceCents, stockAvailable: 100, active })
    .returning();
  return row!;
}

describe('orders API', () => {
  let app: AppInstance;
  beforeAll(async () => {
    app = await buildTestApp();
  });
  beforeEach(resetDb);

  const post = (token: string, payload: object) =>
    app.inject({
      method: 'POST',
      url: '/orders',
      headers: { authorization: `Bearer ${token}` },
      payload,
    });

  it('rejects an unauthenticated request → 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/orders',
      payload: { items: [{ productId: '99999999-9999-9999-9999-999999999999', quantity: 1 }] },
    });
    expect(res.statusCode).toBe(401);
  });

  it('creates a multi-item order (pending) with snapshot prices + summed total → 201', async () => {
    const { token } = await registerAndLogin(app);
    const a = await seedProduct('SKU-A', 1000);
    const b = await seedProduct('SKU-B', 250);

    const res = await post(token, {
      items: [
        { productId: a.id, quantity: 2 },
        { productId: b.id, quantity: 3 },
      ],
    });

    expect(res.statusCode).toBe(201);
    const created = res.json<{
      id: string;
      status: string;
      totalCents: number;
      items: { sku: string; unitPriceCents: number; quantity: number; lineTotalCents: number }[];
    }>();
    expect(created.status).toBe('pending');
    expect(created.totalCents).toBe(2750);
    expect(created.items).toHaveLength(2);

    const items = await db.select().from(orderItems).where(eq(orderItems.orderId, created.id));
    expect(items).toHaveLength(2);
    expect(items.map((i) => i.lineTotalCents).sort((x, y) => x - y)).toEqual([750, 2000]);

    const outbox = await db
      .select()
      .from(outboxMessages)
      .where(eq(outboxMessages.aggregateId, created.id));
    expect(outbox).toHaveLength(1);
    expect(outbox[0]!.eventType).toBe(ORDER_CREATED_EVENT);
    expect(outbox[0]!.publishedAt).toBeNull();

    await db.update(products).set({ priceCents: 9999 }).where(eq(products.id, a.id));
    const [line] = await db.select().from(orderItems).where(eq(orderItems.productId, a.id));
    expect(line!.unitPriceCents).toBe(1000);
  });

  it('rejects an unknown product → 400', async () => {
    const { token } = await registerAndLogin(app);
    const res = await post(token, {
      items: [{ productId: '99999999-9999-9999-9999-999999999999', quantity: 1 }],
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects an inactive product → 400', async () => {
    const { token } = await registerAndLogin(app);
    const inactive = await seedProduct('SKU-OFF', 500, false);
    const res = await post(token, { items: [{ productId: inactive.id, quantity: 1 }] });
    expect(res.statusCode).toBe(400);
  });

  it('rejects qty < 1 → 400', async () => {
    const { token } = await registerAndLogin(app);
    const a = await seedProduct('SKU-A', 1000);
    const res = await post(token, { items: [{ productId: a.id, quantity: 0 }] });
    expect(res.statusCode).toBe(400);
  });

  it('rejects an empty items array → 400', async () => {
    const { token } = await registerAndLogin(app);
    const res = await post(token, { items: [] });
    expect(res.statusCode).toBe(400);
  });

  it('rejects quantity over the max → 400 (no int overflow)', async () => {
    const { token } = await registerAndLogin(app);
    const a = await seedProduct('SKU-A', 1000);
    const res = await post(token, { items: [{ productId: a.id, quantity: 10_001 }] });
    expect(res.statusCode).toBe(400);
  });

  it('GET /orders lists own orders; GET /orders/:id returns detail with items', async () => {
    const { token } = await registerAndLogin(app);
    const a = await seedProduct('SKU-A', 1000);
    const created = await post(token, { items: [{ productId: a.id, quantity: 1 }] }).then((r) =>
      r.json<{ id: string }>(),
    );

    const list = await app.inject({
      method: 'GET',
      url: '/orders',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(list.statusCode).toBe(200);
    expect(list.json<Array<{ id: string }>>().map((o) => o.id)).toContain(created.id);

    const detail = await app.inject({
      method: 'GET',
      url: `/orders/${created.id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json<{ items: unknown[] }>().items).toHaveLength(1);
  });

  it("GET /orders/:id of another user's order → 404 (no IDOR)", async () => {
    const a = await seedProduct('SKU-A', 1000);
    const owner = await registerAndLogin(app);
    const created = await post(owner.token, { items: [{ productId: a.id, quantity: 1 }] }).then(
      (r) => r.json<{ id: string }>(),
    );

    const other = await registerAndLogin(app);
    const res = await app.inject({
      method: 'GET',
      url: `/orders/${created.id}`,
      headers: { authorization: `Bearer ${other.token}` },
    });
    expect(res.statusCode).toBe(404);
  });
});
