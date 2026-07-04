import type { ConsumeMessage } from 'amqplib';
import type { FastifyBaseLogger } from 'fastify';
import type { DB } from '@infra/db/client.js';
import type { MailAdapter } from '@infra/mail/mail-adapter.js';
import type { OrderCreatedPayload } from '@infra/mq/outbox-event-types.js';
import type { HandlerResult } from '@infra/mq/consumer.js';
import { parseEnvelope, claimOnce } from '@infra/mq/idempotent-consumer.js';

interface HandlerDeps {
  db: DB;
  mailAdapter: MailAdapter;
  log: FastifyBaseLogger;
}

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
  const envelope = parseEnvelope<OrderCreatedPayload>(msg, log);
  if (!envelope) return 'ack';

  const eventId = envelope.eventId;

  try {
    let duplicate = false;

    await db.transaction(async (tx) => {
      if (!(await claimOnce(tx, CONSUMER_NAME, eventId))) {
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
