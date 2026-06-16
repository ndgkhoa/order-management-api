import '@config/env-loader.js'; // loads .env before db pool reads process.env (OTel preloaded via --import)
import { buildApp } from '@/app.js';
import { db } from '@infra/db/client.js';
import { createOutboxRelay } from '@infra/mq/outbox-relay.js';
import { createRabbitPublisher } from '@infra/mq/publisher.js';
import { closeMq } from '@infra/mq/connection.js';

/**
 * Process entrypoint: build the app, connect the RabbitMQ publisher, start the
 * outbox relay, listen, and shut down gracefully (stop relay → drain http + close
 * db pool → close mq channel/connection).
 */
async function main(): Promise<void> {
  const app = await buildApp();

  const publisher = await createRabbitPublisher(app.log);
  const relay = createOutboxRelay({
    db,
    publisher,
    log: app.log,
    intervalMs: app.config.OUTBOX_POLL_INTERVAL_MS,
  });

  await app.listen({ port: app.config.PORT, host: '0.0.0.0' });
  relay.start();

  let shuttingDown = false;
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, () => {
      if (shuttingDown) return;
      shuttingDown = true;
      app.log.info({ signal }, 'graceful shutdown start');
      void (async () => {
        try {
          relay.stop();
          await app.close(); // drains in-flight requests, closes db pool (onClose)
          await publisher.close();
          await closeMq();
          process.exit(0);
        } catch (err) {
          app.log.error(err);
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
