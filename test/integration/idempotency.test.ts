import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import type { AppInstance } from '@/app.js';
import { db } from '@infra/db/client.js';
import { orders, products } from '@infra/db/schema.js';
import { buildTestApp, registerAndLogin } from '@test/helpers/build-test-app.js';
import { resetDb } from '@test/helpers/reset-db.js';

/**
 * The Idempotency-Key contract on POST /orders: a retried request (same key) must
 * replay the original response and create NO second order; a different key is a new
 * order; concurrent same-key requests must not double-create (one wins, the other
 * replays or is told it is still in flight).
 */
describe('idempotency on POST /orders (redis-backed)', () => {
  let app: AppInstance;
  let token: string;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  beforeEach(async () => {
    await resetDb();
    await app.redis.flushdb();
    ({ token } = await registerAndLogin(app));
  });

  async function seedProduct(): Promise<string> {
    const [product] = await db
      .insert(products)
      .values({
        sku: `SKU-${crypto.randomUUID()}`,
        name: 'widget',
        priceCents: 1500,
        stockAvailable: 100,
      })
      .returning();
    return product!.id;
  }

  function postOrder(productId: string, idempotencyKey?: string) {
    return app.inject({
      method: 'POST',
      url: '/orders',
      headers: {
        authorization: `Bearer ${token}`,
        ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
      },
      payload: { items: [{ productId, quantity: 1 }] },
    });
  }

  it('replays the original response for a retried key and creates only one order', async () => {
    const productId = await seedProduct();

    const first = await postOrder(productId, 'key-retry-1');
    const second = await postOrder(productId, 'key-retry-1');

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    // identical replayed body (same order id)
    expect(second.json()).toEqual(first.json());

    const rows = await db.select().from(orders);
    expect(rows).toHaveLength(1);
  });

  it('treats a different key as a new order', async () => {
    const productId = await seedProduct();

    const a = await postOrder(productId, 'key-a');
    const b = await postOrder(productId, 'key-b');

    expect(a.statusCode).toBe(201);
    expect(b.statusCode).toBe(201);
    expect(a.json<{ id: string }>().id).not.toBe(b.json<{ id: string }>().id);

    const rows = await db.select().from(orders);
    expect(rows).toHaveLength(2);
  });

  it('does not double-create under concurrent same-key requests', async () => {
    const productId = await seedProduct();

    const [r1, r2] = await Promise.all([
      postOrder(productId, 'key-concurrent'),
      postOrder(productId, 'key-concurrent'),
    ]);

    // one create + one replay (both 201) OR one create (201) + one in-flight (409)
    const codes = [r1.statusCode, r2.statusCode].sort();
    expect(codes).toContain(201);
    expect(codes.every((c) => c === 201 || c === 409)).toBe(true);

    const rows = await db.select().from(orders);
    expect(rows).toHaveLength(1);
  });

  it('does not replay another user’s response for a leaked key', async () => {
    const productId = await seedProduct();
    await postOrder(productId, 'shared-key'); // user A stores under the key

    const { token: tokenB } = await registerAndLogin(app);
    const asUserB = await app.inject({
      method: 'POST',
      url: '/orders',
      headers: { authorization: `Bearer ${tokenB}`, 'idempotency-key': 'shared-key' },
      payload: { items: [{ productId, quantity: 1 }] },
    });

    // user B's key is scoped to user B → it creates B's own order, not A's replay
    expect(asUserB.statusCode).toBe(201);
    const rows = await db.select().from(orders);
    expect(rows).toHaveLength(2);
    const bOrder = rows.find((o) => o.id === asUserB.json<{ id: string }>().id);
    expect(bOrder).toBeDefined();
    expect(bOrder!.userId).not.toBe(rows.find((o) => o.id !== bOrder!.id)!.userId);
  });
});
