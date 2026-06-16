import { describe, it, expect, beforeEach } from 'vitest';
import { pino } from 'pino';
import type { ConsumeMessage } from 'amqplib';
import type { FastifyBaseLogger } from 'fastify';
import { db } from '@infra/db/client.js';
import { processedMessages } from '@infra/db/schema.js';
import { handleOrderCreated } from '@modules/orders/order-created-handler.js';
import type { MailAdapter } from '@infra/mail/mail-adapter.js';
import type { OrderCreatedPayload } from '@infra/mq/outbox-event-types.js';
import { resetDb } from '@test/helpers/reset-db.js';

const log = pino({ level: 'silent' }) as unknown as FastifyBaseLogger;

const payload: OrderCreatedPayload = {
  orderId: crypto.randomUUID(),
  userId: crypto.randomUUID(),
  email: 'buyer@test.dev',
  product: 'widget',
  quantity: 2,
  amount: 1500,
};

/** Builds a minimal ConsumeMessage carrying a messageId + JSON payload. */
function makeMessage(messageId: string): ConsumeMessage {
  return {
    content: Buffer.from(JSON.stringify(payload)),
    properties: { messageId },
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

describe('order-created-handler idempotency (real Postgres)', () => {
  beforeEach(resetDb);

  it('processes once and skips a duplicate delivery (1 row, 1 email)', async () => {
    const messageId = crypto.randomUUID();
    const mail = recordingMailAdapter();
    const deps = { db, mailAdapter: mail, log };

    const first = await handleOrderCreated(makeMessage(messageId), deps);
    const second = await handleOrderCreated(makeMessage(messageId), deps);

    expect(first).toBe('ack');
    expect(second).toBe('ack');
    expect(mail.sent).toHaveLength(1);
    const rows = await db.select().from(processedMessages);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.messageId).toBe(messageId);
  });

  it('rolls back (no processed row) and returns retry when the email fails', async () => {
    const messageId = crypto.randomUUID();
    const failingMail: MailAdapter = {
      sendOrderCreatedEmail: () => Promise.reject(new Error('smtp down')),
    };

    const result = await handleOrderCreated(makeMessage(messageId), {
      db,
      mailAdapter: failingMail,
      log,
    });

    expect(result).toBe('retry');
    const rows = await db.select().from(processedMessages);
    expect(rows).toHaveLength(0);
  });

  it('acks and drops a message with no messageId (avoids a poison loop)', async () => {
    const noId = {
      content: Buffer.from('{}'),
      properties: {},
      fields: {},
    } as unknown as ConsumeMessage;

    const result = await handleOrderCreated(noId, { db, mailAdapter: recordingMailAdapter(), log });

    expect(result).toBe('ack');
  });
});
