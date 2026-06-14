import fp from 'fastify-plugin';
import fastifyEnv from '@fastify/env';
import { envSchema } from '@config/env-schema.js';

/**
 * Validates process.env against the TypeBox schema at boot (fail fast, 12-Factor)
 * and exposes the typed result as `fastify.config`. .env is loaded earlier by
 * the env-loader side-effect module, so we don't use @fastify/env's dotenv here.
 */
export const envPlugin = fp(async (app) => {
  await app.register(fastifyEnv, {
    confKey: 'config',
    schema: envSchema,
    dotenv: false,
  });
});
