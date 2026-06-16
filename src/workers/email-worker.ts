import '@config/env-loader.js'; // loads .env before db pool reads process.env (OTel preloaded via --import)
import { pino } from 'pino';
import { db } from '@infra/db/client.js';
import { closePool } from '@infra/db/pool.js';
import { closeMq, getConnection } from '@infra/mq/connection.js';
import { startConsumer } from '@infra/mq/consumer.js';
import { ORDER_EMAIL_QUEUE, assertTopology } from '@infra/mq/topology.js';
import { createMailer } from '@infra/mail/mailer.js';
import { makeMailAdapter } from '@infra/mail/mail-adapter.js';
import { handleOrderCreated } from '@modules/orders/order-created-handler.js';

function buildLogger() {
  const options = { level: process.env.LOG_LEVEL ?? 'info' };
  return process.env.NODE_ENV === 'production'
    ? pino(options)
    : pino({ ...options, transport: { target: 'pino-pretty' } });
}

/**
 * Email worker: connects to RabbitMQ, asserts topology, and consumes
 * `order.created` idempotently → sends email via Nodemailer (Mailpit in dev).
 * Separate process from the API so async work never blocks the web tier.
 */
async function main(): Promise<void> {
  const log = buildLogger();
  const conn = await getConnection(log);
  const channel = await conn.createChannel();
  await assertTopology(channel);

  const mailAdapter = makeMailAdapter(
    createMailer(),
    process.env.MAIL_FROM ?? 'no-reply@orders.local',
  );

  await startConsumer(
    channel,
    ORDER_EMAIL_QUEUE,
    (msg) => handleOrderCreated(msg, { db, mailAdapter, log }),
    { log },
  );
  log.info({ queue: ORDER_EMAIL_QUEUE }, 'email worker consuming');

  let shuttingDown = false;
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, () => {
      if (shuttingDown) return;
      shuttingDown = true;
      log.info({ signal }, 'worker graceful shutdown');
      void (async () => {
        try {
          await channel.close();
          await closeMq();
          await closePool();
          process.exit(0);
        } catch (err) {
          log.error({ err }, 'worker shutdown error');
          process.exit(1);
        }
      })();
    });
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
