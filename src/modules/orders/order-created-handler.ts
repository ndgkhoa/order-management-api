import type { ConsumeMessage } from 'amqplib';
import type { FastifyBaseLogger } from 'fastify';
import type { DB } from '@infra/db/client.js';
import { processedMessages } from '@infra/db/schema.js';
import type { MailAdapter } from '@infra/mail/mail-adapter.js';
import type { OrderCreatedPayload } from '@infra/mq/outbox-event-types.js';

interface HandlerDeps {
  db: DB;
  mailAdapter: MailAdapter;
  log: FastifyBaseLogger;
}

export type HandlerResult = 'ack' | 'retry';

/**
 * Idempotent consumer for `order.created`.
 * In ONE db transaction: insert the messageId into `processed_messages`
 * (ON CONFLICT DO NOTHING — clean dedupe without poisoning the tx), then send the
 * email. Commit only if both succeed. A duplicate delivery inserts nothing → skip.
 * If the email fails the tx rolls back (no processed row) → message is retried.
 */
export async function handleOrderCreated(
  msg: ConsumeMessage,
  { db, mailAdapter, log }: HandlerDeps,
): Promise<HandlerResult> {
  const messageId = msg.properties.messageId as string | undefined;
  if (!messageId) {
    log.error('message missing messageId; dropping to avoid poison loop');
    return 'ack';
  }

  try {
    const payload = JSON.parse(msg.content.toString()) as OrderCreatedPayload;
    let duplicate = false;

    await db.transaction(async (tx) => {
      const inserted = await tx
        .insert(processedMessages)
        .values({ messageId })
        .onConflictDoNothing()
        .returning();
      if (inserted.length === 0) {
        duplicate = true; // already processed → don't send again
        return;
      }
      await mailAdapter.sendOrderCreatedEmail(payload);
    });

    if (duplicate) log.info({ messageId }, 'duplicate delivery, skipped');
    return 'ack';
  } catch (err) {
    log.error({ err, messageId }, 'order-created handler failed');
    return 'retry';
  }
}
