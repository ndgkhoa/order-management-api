import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@infra/db/client.js';
import { users, orders, orderStatusHistory } from '@infra/db/schema.js';
import { recordOrderTransition } from '@modules/orders/order-status-history.js';
import { resetDb } from '@test/helpers/reset-db.js';

/**
 * The audit writer records each order transition as a from→to row (from is null for the
 * initial creation). Exercised against the real DB because it writes inside a transaction.
 */
describe('recordOrderTransition', () => {
  beforeEach(resetDb);

  it('appends a from→to row for each transition', async () => {
    const [u] = await db
      .insert(users)
      .values({ email: `u-${crypto.randomUUID()}@t.dev`, passwordHash: 'x' })
      .returning();
    const [order] = await db.insert(orders).values({ userId: u!.id, totalCents: 100 }).returning();

    await db.transaction(async (tx) => {
      await recordOrderTransition(tx, {
        orderId: order!.id,
        from: null,
        to: 'pending',
        reason: 'created',
      });
      await recordOrderTransition(tx, { orderId: order!.id, from: 'pending', to: 'paid' });
    });

    const rows = await db
      .select()
      .from(orderStatusHistory)
      .where(eq(orderStatusHistory.orderId, order!.id));

    expect(rows).toHaveLength(2);
    const pairs = rows.map((r) => `${r.fromStatus}->${r.toStatus}`);
    expect(pairs).toContain('null->pending');
    expect(pairs).toContain('pending->paid');
  });
});
