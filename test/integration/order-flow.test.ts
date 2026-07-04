import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { pino } from 'pino';
import { eq } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type { AppInstance } from '@/app.js';
import { db } from '@infra/db/client.js';
import {
  orders,
  orderItems,
  outboxMessages,
  processedMessages,
  products,
} from '@infra/db/schema.js';
import { getConnection, closeMq } from '@infra/mq/connection.js';
import { makeRabbitPublisher, type RabbitPublisher } from '@infra/mq/publisher.js';
import { makeOutboxRelay } from '@infra/mq/outbox-relay.js';
import { startConsumer } from '@infra/mq/consumer.js';
import { assertTopology, ORDER_EMAIL_QUEUE } from '@infra/mq/topology.js';
import { sendEmailOnOrderCreated } from '@/sagas/send-email-on-order-created.js';
import { makeMailAdapter } from '@infra/mail/mail-adapter.js';
import { makeMailer } from '@infra/mail/mailer.js';
import { buildTestApp, registerAndLogin } from '@test/helpers/build-test-app.js';
import { resetDb } from '@test/helpers/reset-db.js';

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

/**
 * The showcase: POST /orders → outbox row → relay publishes to RabbitMQ → worker
 * consumes idempotently → email lands in Mailpit. Everything runs against real
 * containers (no mocks), asserting the full Transactional Outbox flow end-to-end.
 */
describe('order flow integration (pg + rabbit + mailpit)', () => {
  let app: AppInstance;
  let publisher: RabbitPublisher;
  let consumerChannel: Awaited<
    ReturnType<Awaited<ReturnType<typeof getConnection>>['createChannel']>
  >;

  beforeAll(async () => {
    await resetDb();
    // clear any mail left by a previous run so the assertion is unambiguous
    await fetch(`${process.env.MAILPIT_HTTP}/api/v1/messages`, { method: 'DELETE' });

    app = await buildTestApp();
    publisher = await makeRabbitPublisher(log);

    const conn = await getConnection(log);
    consumerChannel = await conn.createChannel();
    await assertTopology(consumerChannel);
    const mailAdapter = makeMailAdapter(makeMailer(), 'no-reply@orders.test');
    await startConsumer(
      consumerChannel,
      ORDER_EMAIL_QUEUE,
      (msg) => sendEmailOnOrderCreated(msg, { db, mailAdapter, log }),
      { log },
    );
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

    // relay publishes the outbox row to RabbitMQ
    const relay = makeOutboxRelay({ db, publisher, log, intervalMs: 1000 });
    await relay.tick();

    // worker consumed → email arrived in Mailpit
    const mail = await findMailpitMessageTo(email);
    expect(mail.To[0]!.Address).toBe(email);

    // outbox stamped, order intact, dedupe row written
    const [outbox] = await db
      .select()
      .from(outboxMessages)
      .where(eq(outboxMessages.aggregateId, created.id));
    expect(outbox!.publishedAt).not.toBeNull();

    const [order] = await db.select().from(orders).where(eq(orders.id, created.id));
    expect(order!.status).toBe('pending');

    // order_items written; no payment side effect in this phase
    const items = await db.select().from(orderItems).where(eq(orderItems.orderId, created.id));
    expect(items).toHaveLength(1);

    const processed = await db
      .select()
      .from(processedMessages)
      .where(eq(processedMessages.eventId, outbox!.eventId));
    expect(processed).toHaveLength(1);
  });
});
