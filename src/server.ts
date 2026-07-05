import '@config/env-loader.js';
import { buildApp } from '@/app';
import { db } from '@infra/db/client';
import { makeOutboxRelay } from '@infra/mq/outbox-relay';
import { makeRabbitPublisher } from '@infra/mq/publisher';
import { closeMq } from '@infra/mq/connection';

async function main(): Promise<void> {
  const app = await buildApp();

  const publisher = await makeRabbitPublisher(app.log);
  const relay = makeOutboxRelay({
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
          await app.close();
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
