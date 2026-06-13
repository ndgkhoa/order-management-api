import './config/load-env.js'; // MUST be first — loads .env before db pool reads process.env
import { buildApp } from './app.js';

/**
 * Process entrypoint: build the app, listen, and shut down gracefully.
 * On SIGTERM/SIGINT we `app.close()` which stops accepting connections, drains
 * in-flight requests, then runs onClose hooks (closes the db pool).
 */
async function main(): Promise<void> {
  const app = await buildApp();
  await app.listen({ port: app.config.PORT, host: '0.0.0.0' });

  let shuttingDown = false;
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, () => {
      if (shuttingDown) return;
      shuttingDown = true;
      app.log.info({ signal }, 'graceful shutdown start');
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
