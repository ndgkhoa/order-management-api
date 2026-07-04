import '@config/env-loader.js'; // loads .env before db pool reads process.env (OTel preloaded via --import)
import { pino } from 'pino';
import { db } from '@infra/db/client.js';
import { closePool } from '@infra/db/pool.js';
import { closeMq, getConnection } from '@infra/mq/connection.js';
import { startConsumer } from '@infra/mq/consumer.js';
import {
  ORDER_EMAIL_QUEUE,
  ORDER_INVENTORY_QUEUE,
  PAYMENT_CREATE_QUEUE,
  MOCK_PROVIDER_QUEUE,
  PAYMENT_COMPLETE_QUEUE,
  PAYMENT_COMPENSATE_QUEUE,
  SHIPPING_QUEUE,
  NOTIFICATION_QUEUE,
  assertTopology,
} from '@infra/mq/topology.js';
import { makeRabbitPublisher } from '@infra/mq/publisher.js';
import { makeOutboxRelay } from '@infra/mq/outbox-relay.js';
import { makeMailer } from '@infra/mail/mailer.js';
import { makeMailAdapter } from '@infra/mail/mail-adapter.js';
import { sendEmailOnOrderCreated } from '@/sagas/send-email-on-order-created.js';
import { reserveOnOrderCreated } from '@/sagas/reserve-on-order-created.js';
import { makeOrderReaper } from './order-reaper-worker.js';
import { createPaymentOnReserved } from '@/sagas/create-payment-on-reserved.js';
import { completeOnPaymentSucceeded } from '@/sagas/complete-on-payment-succeeded.js';
import { compensateOnPaymentFailed } from '@/sagas/compensate-on-payment-failed.js';
import {
  fakeProviderOnPaymentCreated,
  type FakeProviderConfig,
} from '@infra/providers/fake-payment-provider.js';
import { makeShippingConsumer } from './fake-shipping-worker.js';
import { makeNotificationDispatcher } from '@modules/notifications/dispatch-notifications.js';
import { makeEmailProvider } from '@infra/providers/email-provider.js';
import { makeSmsProvider } from '@infra/providers/sms-provider.js';

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

  const mailer = makeMailer();
  const mailFrom = process.env.MAIL_FROM ?? 'no-reply@orders.local';
  const mailAdapter = makeMailAdapter(mailer, mailFrom);
  await startConsumer(
    emailChannel,
    ORDER_EMAIL_QUEUE,
    (msg) => sendEmailOnOrderCreated(msg, { db, mailAdapter, log }),
    { log },
  );
  await startConsumer(
    inventoryChannel,
    ORDER_INVENTORY_QUEUE,
    (msg) => reserveOnOrderCreated(msg, { db, log }),
    { log },
  );

  // Payment saga consumers, each on its own channel.
  const mockConfig: FakeProviderConfig = {
    webhookUrl: process.env.PAYMENT_WEBHOOK_URL ?? 'http://localhost:3000/webhooks/payment',
    secret: process.env.WEBHOOK_HMAC_SECRET ?? '',
    delayMs: num(process.env.MOCK_PAYMENT_DELAY_MS, 2000),
  };
  const paymentCreateChannel = await conn.createChannel();
  const mockProviderChannel = await conn.createChannel();
  const paymentCompleteChannel = await conn.createChannel();
  const paymentCompensateChannel = await conn.createChannel();
  await startConsumer(
    paymentCreateChannel,
    PAYMENT_CREATE_QUEUE,
    (msg) => createPaymentOnReserved(msg, { db, log }),
    { log },
  );
  await startConsumer(
    mockProviderChannel,
    MOCK_PROVIDER_QUEUE,
    (msg) => fakeProviderOnPaymentCreated(msg, { db, config: mockConfig, log }),
    { log },
  );
  await startConsumer(
    paymentCompleteChannel,
    PAYMENT_COMPLETE_QUEUE,
    (msg) => completeOnPaymentSucceeded(msg, { db, log }),
    { log },
  );
  await startConsumer(
    paymentCompensateChannel,
    PAYMENT_COMPENSATE_QUEUE,
    (msg) => compensateOnPaymentFailed(msg, { db, log }),
    { log },
  );

  const shippingChannel = await conn.createChannel();
  const shippingConsumer = makeShippingConsumer({
    db,
    config: { stepMs: num(process.env.SHIPPING_STEP_MS, 3000) },
    log,
  });
  await startConsumer(shippingChannel, SHIPPING_QUEUE, shippingConsumer, { log });

  // Notifications: one consumer fans user-facing events out to channel providers.
  const notificationChannel = await conn.createChannel();
  const notificationHandler = makeNotificationDispatcher({
    db,
    providers: { email: makeEmailProvider(mailer, mailFrom), sms: makeSmsProvider(log) },
    log,
  });
  await startConsumer(notificationChannel, NOTIFICATION_QUEUE, notificationHandler, { log });

  const publisher = await makeRabbitPublisher(log);
  const relay = makeOutboxRelay({
    db,
    publisher,
    log,
    intervalMs: num(process.env.OUTBOX_POLL_INTERVAL_MS, 1000),
  });
  relay.start();

  const reaper = makeOrderReaper({
    db,
    log,
    intervalMs: num(process.env.ORDER_REAPER_INTERVAL_MS, 60_000),
    thresholdMs: num(process.env.STUCK_ORDER_THRESHOLD_MS, 900_000),
  });
  reaper.start();

  log.info(
    {
      queues: [
        ORDER_EMAIL_QUEUE,
        ORDER_INVENTORY_QUEUE,
        PAYMENT_CREATE_QUEUE,
        MOCK_PROVIDER_QUEUE,
        PAYMENT_COMPLETE_QUEUE,
        PAYMENT_COMPENSATE_QUEUE,
        SHIPPING_QUEUE,
        NOTIFICATION_QUEUE,
      ],
    },
    'worker consuming (email + inventory + payment saga + shipping + notifications) with relay + reaper',
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
          await paymentCreateChannel.close();
          await mockProviderChannel.close();
          await paymentCompleteChannel.close();
          await paymentCompensateChannel.close();
          await shippingChannel.close();
          await notificationChannel.close();
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
