import fp from 'fastify-plugin';
import { db } from '@infra/db/client.js';
import { closePool } from '@infra/db/pool.js';

export const dbPlugin = fp((app) => {
  app.decorate('db', db);
  app.addHook('onClose', async () => {
    await closePool();
  });
});
