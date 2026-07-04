import type { ConsumeMessage } from 'amqplib';
import type { FastifyBaseLogger } from 'fastify';
import { processedMessages } from '@infra/db/schema.js';
import type { Tx } from '@modules/inventory/adjust-stock.js';
import type { EventEnvelope } from '@infra/mq/event-envelope.js';

/**
 * Parses a message body into an EventEnvelope and validates it carries an eventId. Returns null
 * (and logs) for a malformed body or a missing eventId — the caller should ack-drop those to
 * avoid a poison loop. Shared by every idempotent consumer.
 */
export function parseEnvelope<P>(
  msg: ConsumeMessage,
  log: FastifyBaseLogger,
): EventEnvelope<P> | null {
  let envelope: EventEnvelope<P>;
  try {
    envelope = JSON.parse(msg.content.toString()) as EventEnvelope<P>;
  } catch (err) {
    log.error({ err }, 'malformed message body; dropping to avoid poison loop');
    return null;
  }
  if (!envelope.eventId) {
    log.error('message missing eventId; dropping to avoid poison loop');
    return null;
  }
  return envelope;
}

/**
 * Per-consumer idempotency claim: inserts (consumerName, eventId) into processed_messages inside
 * the caller's transaction. Returns true if this delivery is the first (proceed), false if the
 * row already existed (duplicate delivery → the caller must skip its side effects).
 */
export async function claimOnce(tx: Tx, consumerName: string, eventId: string): Promise<boolean> {
  const inserted = await tx
    .insert(processedMessages)
    .values({ consumerName, eventId })
    .onConflictDoNothing()
    .returning();
  return inserted.length > 0;
}
