import './config/load-env.js'; // MUST be first — loads .env before db pool reads process.env
import { buildApp } from './app.js';
import { db } from '@infra/db/client.js';
import { createOutboxRelay } from '@infra/mq/outbox-relay.js';
import { createLogPublisher } from '@infra/mq/outbox-publisher.js';

/**
 * Process entrypoint: build the app, start the outbox relay, listen, and shut
 * down gracefully. On SIGTERM/SIGINT we stop the relay, then `app.close()` drains
 * in-flight requests and runs onClose hooks (closes the db pool).
 */
async function main(): Promise<void> {
  const app = await buildApp();

  // Phase 07 replaces the stub log-publisher with the real RabbitMQ publisher.
  const relay = createOutboxRelay({
    db,
    publisher: createLogPublisher(app.log),
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
      relay.stop();
      app
        .close()
        .then(() => process.exit(0))
        .catch((err: unknown) => {
          app.log.error(err);
          process.exit(1);
        });
    });
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
