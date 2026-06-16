import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import type { AppInstance } from '@/app.js';
import { db } from '@infra/db/client.js';
import { outboxMessages } from '@infra/db/schema.js';
import { ORDER_CREATED_EVENT } from '@infra/mq/outbox-event-types.js';
import { buildTestApp, registerAndLogin } from '@test/helpers/build-test-app.js';
import { resetDb } from '@test/helpers/reset-db.js';

describe('orders API (app.inject)', () => {
  let app: AppInstance;
  beforeAll(async () => {
    app = await buildTestApp();
  });
  beforeEach(resetDb);

  const order = { product: 'widget', quantity: 2, amount: 1500 };

  it('rejects an unauthenticated request → 401', async () => {
    const res = await app.inject({ method: 'POST', url: '/orders', payload: order });
    expect(res.statusCode).toBe(401);
  });

  it('creates an order + outbox row atomically → 201', async () => {
    const { token } = await registerAndLogin(app);
    const res = await app.inject({
      method: 'POST',
      url: '/orders',
      headers: { authorization: `Bearer ${token}` },
      payload: order,
    });

    expect(res.statusCode).toBe(201);
    const created = res.json<{ id: string; status: string }>();
    expect(created.status).toBe('created');

    const outbox = await db
      .select()
      .from(outboxMessages)
      .where(eq(outboxMessages.aggregateId, created.id));
    expect(outbox).toHaveLength(1);
    expect(outbox[0]!.eventType).toBe(ORDER_CREATED_EVENT);
    expect(outbox[0]!.publishedAt).toBeNull();
  });

  it('rejects an invalid body (quantity 0) → 400', async () => {
    const { token } = await registerAndLogin(app);
    const res = await app.inject({
      method: 'POST',
      url: '/orders',
      headers: { authorization: `Bearer ${token}` },
      payload: { ...order, quantity: 0 },
    });
    expect(res.statusCode).toBe(400);
  });
});
