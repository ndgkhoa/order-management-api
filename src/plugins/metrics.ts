import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import fastifyMetricsImport from 'fastify-metrics';

const fastifyMetrics = ((fastifyMetricsImport as { default?: unknown }).default ??
  fastifyMetricsImport) as FastifyPluginAsync<{ endpoint: string }>;

export const metricsPlugin = fp(async (app) => {
  await app.register(fastifyMetrics, { endpoint: '/metrics' });
});
