import { describe, it, expect, beforeEach } from 'vitest';
import { pino } from 'pino';
import type { ConsumeMessage } from 'amqplib';
import type { FastifyBaseLogger } from 'fastify';
import { db } from '@infra/db/client.js';
import { processedMessages } from '@infra/db/schema.js';
import { sendEmailOnOrderCreated } from '@modules/orders/sagas/send-email-on-order-created.js';
import type { MailAdapter } from '@infra/mail/mail-adapter.js';
import type { OrderCreatedPayload } from '@infra/mq/outbox-event-types.js';
import { resetDb } from '@test/helpers/reset-db.js';

const log = pino({ level: 'silent' }) as unknown as FastifyBaseLogger;

const payload: OrderCreatedPayload = {
  orderId: crypto.randomUUID(),
  userId: crypto.randomUUID(),
  email: 'buyer@test.dev',
  items: [{ productId: crypto.randomUUID(), sku: 'SKU-A', unitPriceCents: 750, quantity: 2 }],
  totalCents: 1500,
};

/** Builds a minimal ConsumeMessage whose body is an EventEnvelope keyed by eventId. */
function makeMessage(eventId: string): ConsumeMessage {
  const envelope = {
    eventId,
    eventType: 'order.created',
    correlationId: payload.orderId,
    occurredAt: new Date().toISOString(),
    payload,
  };
  return {
    content: Buffer.from(JSON.stringify(envelope)),
    properties: { messageId: eventId },
    fields: {},
  } as unknown as ConsumeMessage;
}

function recordingMailAdapter(): MailAdapter & { sent: OrderCreatedPayload[] } {
  const sent: OrderCreatedPayload[] = [];
  return {
    sent,
    sendOrderCreatedEmail: (p) => {
      sent.push(p);
      return Promise.resolve();
    },
  };
}

describe('send-email-on-order-created idempotency (real Postgres)', () => {
  beforeEach(resetDb);

  it('processes once and skips a duplicate delivery (1 row, 1 email)', async () => {
    const eventId = crypto.randomUUID();
    const mail = recordingMailAdapter();
    const deps = { db, mailAdapter: mail, log };

    const first = await sendEmailOnOrderCreated(makeMessage(eventId), deps);
    const second = await sendEmailOnOrderCreated(makeMessage(eventId), deps);

    expect(first).toBe('ack');
    expect(second).toBe('ack');
    expect(mail.sent).toHaveLength(1);
    const rows = await db.select().from(processedMessages);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.eventId).toBe(eventId);
    expect(rows[0]!.consumerName).toBe('email');
  });

  it('rolls back (no processed row) and returns retry when the email fails', async () => {
    const eventId = crypto.randomUUID();
    const failingMail: MailAdapter = {
      sendOrderCreatedEmail: () => Promise.reject(new Error('smtp down')),
    };

    const result = await sendEmailOnOrderCreated(makeMessage(eventId), {
      db,
      mailAdapter: failingMail,
      log,
    });

    expect(result).toBe('retry');
    const rows = await db.select().from(processedMessages);
    expect(rows).toHaveLength(0);
  });

  it('acks and drops a message with no eventId (avoids a poison loop)', async () => {
    const noId = {
      content: Buffer.from(JSON.stringify({ eventType: 'order.created', payload })),
      properties: {},
      fields: {},
    } as unknown as ConsumeMessage;

    const result = await sendEmailOnOrderCreated(noId, {
      db,
      mailAdapter: recordingMailAdapter(),
      log,
    });

    expect(result).toBe('ack');
  });
});
