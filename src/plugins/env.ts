import fp from 'fastify-plugin';
import fastifyEnv from '@fastify/env';
import { envSchema } from '@config/env-schema';

export const envPlugin = fp(async (app) => {
  await app.register(fastifyEnv, {
    confKey: 'config',
    schema: envSchema,
    dotenv: false,
  });
});
