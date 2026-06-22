import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '@infra/db/client.js';
import { processedMessages } from '@infra/db/schema.js';
import { resetDb } from '@test/helpers/reset-db.js';

/** The composite (consumer_name, event_id) PK is the dedupe key the consumers rely on. */
describe('processed_messages composite dedup (real Postgres)', () => {
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
    expect(second).toHaveLength(0); // dedup hit
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
    expect(inventory).toHaveLength(1); // independent consumer not blocked
  });
});
