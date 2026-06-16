import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import fastifyMetricsImport from 'fastify-metrics';

// fastify-metrics ships a double-wrapped default under NodeNext ESM interop
// (the import resolves to `{ default: plugin }`); unwrap the real plugin function.
const fastifyMetrics = ((fastifyMetricsImport as { default?: unknown }).default ??
  fastifyMetricsImport) as FastifyPluginAsync<{ endpoint: string }>;

/**
 * Exposes Prometheus metrics at /metrics: default process metrics + per-route
 * HTTP histogram (RED — rate, errors, duration). Prometheus scrapes api:3000/metrics
 * (configured in phase 02), Grafana graphs it.
 */
export const metricsPlugin = fp(async (app) => {
  await app.register(fastifyMetrics, { endpoint: '/metrics' });
});
