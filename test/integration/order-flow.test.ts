import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { pino } from 'pino';
import { eq } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type { AppInstance } from '@/app';
import { db } from '@infra/db/client';
import { orders, orderItems, outboxMessages, processedMessages, products } from '@infra/db/schema';
import { getConnection, closeMq } from '@infra/mq/connection';
import { makeRabbitPublisher, type RabbitPublisher } from '@infra/mq/publisher';
import { makeOutboxRelay } from '@infra/mq/outbox-relay';
import { startConsumer } from '@infra/mq/consumer';
import { assertTopology, NOTIFICATION_QUEUE } from '@infra/mq/topology';
import { makeNotificationDispatcher } from '@modules/notifications/notifications-dispatch';
import { makeEmailProvider } from '@modules/notifications/channels/email';
import { makeMailer } from '@infra/mail/mailer';
import { buildTestApp, registerAndLogin } from '@test/helpers/build-test-app';
import { resetDb } from '@test/helpers/reset-db';

const log = pino({ level: 'silent' }) as unknown as FastifyBaseLogger;

interface MailpitMessage {
  To: { Address: string }[];
}

async function findMailpitMessageTo(email: string, timeoutMs = 15_000): Promise<MailpitMessage> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await fetch(`${process.env.MAILPIT_HTTP}/api/v1/messages`);
    const body = (await res.json()) as { messages: MailpitMessage[] };
    const hit = body.messages.find((m) => m.To.some((t) => t.Address === email));
    if (hit) return hit;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`no Mailpit message delivered to ${email} within ${timeoutMs}ms`);
}

describe('order flow (outbox → rabbit → email)', () => {
  let app: AppInstance;
  let publisher: RabbitPublisher;
  let consumerChannel: Awaited<
    ReturnType<Awaited<ReturnType<typeof getConnection>>['createChannel']>
  >;

  beforeAll(async () => {
    await resetDb();
    await fetch(`${process.env.MAILPIT_HTTP}/api/v1/messages`, { method: 'DELETE' });

    app = await buildTestApp();
    publisher = await makeRabbitPublisher(log);

    const conn = await getConnection(log);
    consumerChannel = await conn.createChannel();
    await assertTopology(consumerChannel);
    const dispatcher = makeNotificationDispatcher({
      db,
      providers: { email: makeEmailProvider(makeMailer(), 'no-reply@orders.test') },
      log,
    });
    await startConsumer(consumerChannel, NOTIFICATION_QUEUE, dispatcher, { log });
  });

  afterAll(async () => {
    await consumerChannel.close();
    await publisher.close();
    await closeMq();
  });

  it('delivers an order-created email through the whole pipeline', async () => {
    const { token, email } = await registerAndLogin(app);
    const [product] = await db
      .insert(products)
      .values({
        sku: `SKU-${crypto.randomUUID()}`,
        name: 'widget',
        priceCents: 1500,
        stockAvailable: 10,
      })
      .returning();
    const created = await app
      .inject({
        method: 'POST',
        url: '/orders',
        headers: { authorization: `Bearer ${token}` },
        payload: { items: [{ productId: product!.id, quantity: 2 }] },
      })
      .then((r) => r.json<{ id: string; status: string }>());

    const relay = makeOutboxRelay({ db, publisher, log, intervalMs: 1000 });
    await relay.tick();

    const mail = await findMailpitMessageTo(email);
    expect(mail.To[0]!.Address).toBe(email);

    const [outbox] = await db
      .select()
      .from(outboxMessages)
      .where(eq(outboxMessages.aggregateId, created.id));
    expect(outbox!.publishedAt).not.toBeNull();

    const [order] = await db.select().from(orders).where(eq(orders.id, created.id));
    expect(order!.status).toBe('pending');

    const items = await db.select().from(orderItems).where(eq(orderItems.orderId, created.id));
    expect(items).toHaveLength(1);

    const processed = await db
      .select()
      .from(processedMessages)
      .where(eq(processedMessages.eventId, outbox!.eventId));
    expect(processed).toHaveLength(1);
  });
});
