import { describe, it, expect, beforeEach } from 'vitest';
import { pino } from 'pino';
import { eq, isNull } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import { db } from '@infra/db/client.js';
import { outboxMessages } from '@infra/db/schema.js';
import { makeOutboxRelay } from '@infra/mq/outbox-relay.js';
import type { OutboxMessage, OutboxPublisher } from '@infra/mq/outbox-publisher.js';
import { resetDb } from '@test/helpers/reset-db.js';

const log = pino({ level: 'silent' }) as unknown as FastifyBaseLogger;

/** Records publish calls; the publisher is the only stub (external system seam). */
function recordingPublisher(): OutboxPublisher & { calls: OutboxMessage[] } {
  const calls: OutboxMessage[] = [];
  return {
    calls,
    publish: (m) => {
      calls.push(m);
      return Promise.resolve();
    },
  };
}

async function insertOutboxRow(eventType: string, createdAt: Date) {
  const [row] = await db
    .insert(outboxMessages)
    .values({
      aggregateType: 'order',
      aggregateId: crypto.randomUUID(),
      eventType,
      payload: { hello: 'world' },
      createdAt,
    })
    .returning();
  return row!;
}

describe('outbox-relay (real Postgres)', () => {
  beforeEach(resetDb);

  it('publishes unsent rows in createdAt order and stamps published_at', async () => {
    const first = await insertOutboxRow('order.created', new Date('2026-01-01T00:00:00Z'));
    const second = await insertOutboxRow('order.created', new Date('2026-01-01T00:00:01Z'));
    const publisher = recordingPublisher();
    const relay = makeOutboxRelay({ db, publisher, log, intervalMs: 1000 });

    await relay.tick();

    // messageId is the logical eventId (what consumers dedupe on), not the row id.
    expect(publisher.calls.map((c) => c.messageId)).toEqual([first.eventId, second.eventId]);
    const remaining = await db
      .select()
      .from(outboxMessages)
      .where(isNull(outboxMessages.publishedAt));
    expect(remaining).toHaveLength(0);
  });

  it('wraps the payload in a versioned envelope (eventId, correlationId, occurredAt)', async () => {
    const row = await insertOutboxRow('order.created', new Date('2026-01-01T00:00:00Z'));
    const publisher = recordingPublisher();
    const relay = makeOutboxRelay({ db, publisher, log, intervalMs: 1000 });

    await relay.tick();

    const envelope = publisher.calls[0]!.payload as {
      eventId: string;
      eventType: string;
      correlationId: string;
      occurredAt: string;
      payload: unknown;
    };
    expect(envelope.eventId).toBe(row.eventId);
    expect(envelope.eventType).toBe('order.created');
    expect(envelope.correlationId).toBe(row.aggregateId);
    expect(typeof envelope.occurredAt).toBe('string');
    expect(envelope.payload).toEqual({ hello: 'world' });
  });

  it('leaves the row unpublished when the publisher throws (retry next tick)', async () => {
    const row = await insertOutboxRow('order.created', new Date('2026-01-01T00:00:00Z'));
    const failing: OutboxPublisher = { publish: () => Promise.reject(new Error('broker down')) };
    const relay = makeOutboxRelay({ db, publisher: failing, log, intervalMs: 1000 });

    await relay.tick(); // relay swallows the error and rolls back the tx

    const [reloaded] = await db.select().from(outboxMessages).where(eq(outboxMessages.id, row.id));
    expect(reloaded!.publishedAt).toBeNull();
  });
});
