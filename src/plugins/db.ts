import fp from 'fastify-plugin';
import { db } from '@infra/db/client.js';
import { closePool } from '@infra/db/pool.js';

/** Exposes the Drizzle client as `fastify.db` and closes the pool on shutdown. */
export const dbPlugin = fp((app) => {
  app.decorate('db', db);
  app.addHook('onClose', async () => {
    await closePool();
  });
});
