import fp from 'fastify-plugin';
import { db } from '@infra/db/client';
import { closePool } from '@infra/db/pool';

export const dbPlugin = fp((app) => {
  app.decorate('db', db);
  app.addHook('onClose', async () => {
    await closePool();
  });
});
