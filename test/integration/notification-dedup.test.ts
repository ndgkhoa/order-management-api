import { describe, it, expect, beforeEach, vi } from 'vitest';
import { pino } from 'pino';
import type { ConsumeMessage } from 'amqplib';
import type { FastifyBaseLogger } from 'fastify';
import { db } from '@infra/db/client.js';
import { users, orders } from '@infra/db/schema.js';
import { makeNotificationHandler } from '@modules/notifications/notification-handler.js';
import type { NotificationProvider } from '@infra/notify/notification-provider.js';
import { resetDb } from '@test/helpers/reset-db.js';

const log = pino({ level: 'silent' }) as unknown as FastifyBaseLogger;

function orderPaidMsg(eventId: string, orderId: string): ConsumeMessage {
  const envelope = {
    eventId,
    eventType: 'order.paid',
    correlationId: orderId,
    occurredAt: new Date().toISOString(),
    payload: { orderId, paymentId: crypto.randomUUID() },
  };
  return {
    content: Buffer.from(JSON.stringify(envelope)),
    properties: { messageId: eventId },
    fields: {},
  } as unknown as ConsumeMessage;
}

async function seedUserOrder() {
  const email = `u-${crypto.randomUUID()}@t.dev`;
  const [u] = await db.insert(users).values({ email, passwordHash: 'x' }).returning();
  const [order] = await db.insert(orders).values({ userId: u!.id, totalCents: 100 }).returning();
  return { orderId: order!.id, email };
}

describe('notification handler dedup', () => {
  beforeEach(resetDb);

  it('sends once and dispatches to the recipient even when the event is redelivered', async () => {
    const { orderId, email } = await seedUserOrder();
    const send = vi.fn<NotificationProvider['send']>().mockResolvedValue(undefined);
    const emailProvider: NotificationProvider = { channel: 'email', send };
    const handler = makeNotificationHandler({ db, providers: { email: emailProvider }, log });

    const eventId = crypto.randomUUID();
    expect(await handler(orderPaidMsg(eventId, orderId))).toBe('ack');
    expect(await handler(orderPaidMsg(eventId, orderId))).toBe('ack'); // redelivery

    expect(send).toHaveBeenCalledTimes(1); // deduped on eventId
    expect(send.mock.calls[0]![0]).toBe(email); // dispatched to the order's owner
  });

  it('acks and does not send for an unrouted event', async () => {
    const { orderId } = await seedUserOrder();
    const send = vi.fn<NotificationProvider['send']>().mockResolvedValue(undefined);
    const handler = makeNotificationHandler({
      db,
      providers: { email: { channel: 'email', send } },
      log,
    });

    const envelope = {
      eventId: crypto.randomUUID(),
      eventType: 'order.created',
      correlationId: orderId,
      occurredAt: new Date().toISOString(),
      payload: { orderId },
    };
    const msg = {
      content: Buffer.from(JSON.stringify(envelope)),
      properties: {},
      fields: {},
    } as unknown as ConsumeMessage;

    expect(await handler(msg)).toBe('ack');
    expect(send).not.toHaveBeenCalled();
  });
});
