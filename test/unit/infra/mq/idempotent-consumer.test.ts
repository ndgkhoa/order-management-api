import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '@infra/db/client';
import { processedMessages } from '@infra/db/schema';
import { resetDb } from '@test/helpers/reset-db';

describe('processedMessages dedup (real Postgres)', () => {
  beforeEach(resetDb);

  it('same (consumer, eventId) twice → second insert conflicts and is skipped', async () => {
    const eventId = crypto.randomUUID();
    const first = await db
      .insert(processedMessages)
      .values({ consumerName: 'email', eventId })
      .onConflictDoNothing()
      .returning();
    const second = await db
      .insert(processedMessages)
      .values({ consumerName: 'email', eventId })
      .onConflictDoNothing()
      .returning();

    expect(first).toHaveLength(1);
    expect(second).toHaveLength(0);
  });

  it('same eventId across different consumers both succeed (fan-out safe)', async () => {
    const eventId = crypto.randomUUID();
    const email = await db
      .insert(processedMessages)
      .values({ consumerName: 'email', eventId })
      .onConflictDoNothing()
      .returning();
    const inventory = await db
      .insert(processedMessages)
      .values({ consumerName: 'inventory', eventId })
      .onConflictDoNothing()
      .returning();

    expect(email).toHaveLength(1);
    expect(inventory).toHaveLength(1);
  });
});
