import '@config/env-loader.js'; // loads .env before db pool reads process.env (OTel preloaded via --import)
import { pino } from 'pino';
import { db } from '@infra/db/client.js';
import { closePool } from '@infra/db/pool.js';
import { closeMq, getConnection } from '@infra/mq/connection.js';
import { startConsumer } from '@infra/mq/consumer.js';
import { ORDER_EMAIL_QUEUE, ORDER_INVENTORY_QUEUE, assertTopology } from '@infra/mq/topology.js';
import { createRabbitPublisher } from '@infra/mq/publisher.js';
import { createOutboxRelay } from '@infra/mq/outbox-relay.js';
import { createMailer } from '@infra/mail/mailer.js';
import { makeMailAdapter } from '@infra/mail/mail-adapter.js';
import { handleOrderCreated } from '@modules/orders/order-created-handler.js';
import { reserveOnOrderCreated } from '@modules/inventory/reserve-on-order-created.js';
import { createOrderReaper } from '@modules/orders/order-reaper.js';

function buildLogger() {
  const options = { level: process.env.LOG_LEVEL ?? 'info' };
  return process.env.NODE_ENV === 'production'
    ? pino(options)
    : pino({ ...options, transport: { target: 'pino-pretty' } });
}

const num = (v: string | undefined, fallback: number) => (v ? Number(v) : fallback);

/**
 * Background worker: hosts every async consumer plus the outbox relay and the stuck-order
 * reaper in one process. Each consumer gets its own channel (independent prefetch) on its
 * own queue. Running the relay here (in addition to the API) means consumer-emitted saga
 * events still publish even if the API is down — `FOR UPDATE SKIP LOCKED` keeps the two
 * relays from double-publishing.
 */
async function main(): Promise<void> {
  const log = buildLogger();
  const conn = await getConnection(log);

  const emailChannel = await conn.createChannel();
  await assertTopology(emailChannel); // idempotent; declares all queues once
  const inventoryChannel = await conn.createChannel();

  const mailAdapter = makeMailAdapter(
    createMailer(),
    process.env.MAIL_FROM ?? 'no-reply@orders.local',
  );
  await startConsumer(
    emailChannel,
    ORDER_EMAIL_QUEUE,
    (msg) => handleOrderCreated(msg, { db, mailAdapter, log }),
    { log },
  );
  await startConsumer(
    inventoryChannel,
    ORDER_INVENTORY_QUEUE,
    (msg) => reserveOnOrderCreated(msg, { db, log }),
    { log },
  );

  const publisher = await createRabbitPublisher(log);
  const relay = createOutboxRelay({
    db,
    publisher,
    log,
    intervalMs: num(process.env.OUTBOX_POLL_INTERVAL_MS, 1000),
  });
  relay.start();

  const reaper = createOrderReaper({
    db,
    log,
    intervalMs: num(process.env.ORDER_REAPER_INTERVAL_MS, 60_000),
    thresholdMs: num(process.env.STUCK_ORDER_THRESHOLD_MS, 900_000),
  });
  reaper.start();

  log.info(
    { queues: [ORDER_EMAIL_QUEUE, ORDER_INVENTORY_QUEUE] },
    'worker consuming (email + inventory) with relay + reaper',
  );

  let shuttingDown = false;
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, () => {
      if (shuttingDown) return;
      shuttingDown = true;
      log.info({ signal }, 'worker graceful shutdown');
      void (async () => {
        try {
          reaper.stop();
          relay.stop();
          await emailChannel.close();
          await inventoryChannel.close();
          await publisher.close();
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
