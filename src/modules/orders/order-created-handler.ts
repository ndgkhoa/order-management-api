import type { ConsumeMessage } from 'amqplib';
import type { FastifyBaseLogger } from 'fastify';
import type { DB } from '@infra/db/client.js';
import { processedMessages } from '@infra/db/schema.js';
import type { MailAdapter } from '@infra/mail/mail-adapter.js';
import type { OrderCreatedPayload } from '@infra/mq/outbox-event-types.js';
import type { EventEnvelope } from '@infra/mq/event-envelope.js';

interface HandlerDeps {
  db: DB;
  mailAdapter: MailAdapter;
  log: FastifyBaseLogger;
}

export type HandlerResult = 'ack' | 'retry';

/** This consumer's identity in the per-consumer dedupe key. */
const CONSUMER_NAME = 'email';

/**
 * Idempotent consumer for `order.created`.
 * The message body is an EventEnvelope; dedupe is keyed on (consumerName, envelope.eventId).
 * In ONE db transaction: insert that key into `processed_messages` (ON CONFLICT DO NOTHING —
 * clean dedupe without poisoning the tx), then send the email. Commit only if both succeed.
 * A duplicate delivery inserts nothing → skip. If the email fails the tx rolls back
 * (no processed row) → message is retried.
 */
export async function handleOrderCreated(
  msg: ConsumeMessage,
  { db, mailAdapter, log }: HandlerDeps,
): Promise<HandlerResult> {
  let envelope: EventEnvelope<OrderCreatedPayload>;
  try {
    envelope = JSON.parse(msg.content.toString()) as EventEnvelope<OrderCreatedPayload>;
  } catch (err) {
    log.error({ err }, 'malformed message body; dropping to avoid poison loop');
    return 'ack';
  }

  const eventId = envelope.eventId;
  if (!eventId) {
    log.error('message missing eventId; dropping to avoid poison loop');
    return 'ack';
  }

  try {
    let duplicate = false;

    await db.transaction(async (tx) => {
      const inserted = await tx
        .insert(processedMessages)
        .values({ consumerName: CONSUMER_NAME, eventId })
        .onConflictDoNothing()
        .returning();
      if (inserted.length === 0) {
        duplicate = true; // already processed → don't send again
        return;
      }
      await mailAdapter.sendOrderCreatedEmail(envelope.payload);
    });

    if (duplicate) log.info({ eventId }, 'duplicate delivery, skipped');
    return 'ack';
  } catch (err) {
    log.error({ err, eventId }, 'order-created handler failed');
    return 'retry';
  }
}
