# Phase 08 — Observability (Metrics, Tracing, Sentry)

## Context Links

- Source of truth: [`docs/tech-stack.md`](../../docs/tech-stack.md) · Overview: [`plan.md`](./plan.md)
- Depends on: [Phase 07](./phase-07-rabbitmq-and-email-worker.md) (publish/consume to trace). Can run parallel with [Phase 09](./phase-09-testing.md).

## Overview

- **Priority:** P2 · **Status:** Pending
- **Description:** `fastify-metrics` exposing `/metrics` for Prometheus; OpenTelemetry SDK + instrumentation (http, pg, amqplib) → Jaeger (trace propagated across publish→consume); Sentry adapter init + error capture; wire correlation id into logs & traces.

## Key Insights

- **OTel must init FIRST**, before importing instrumented libs (http/pg/amqplib). Use a `--import` / `-r` preload file (`telemetry/otel.ts`) so SDK starts before `app.ts` requires anything. Both API and worker preload it.
- **Trace propagation across RabbitMQ is automatic** with `@opentelemetry/instrumentation-amqplib`: it injects `traceparent` into AMQP message headers on publish and extracts on consume → API span and worker span join ONE trace. No manual context plumbing.
- **Correlation id ↔ trace:** log Fastify `reqId` and OTel `trace_id` together. Add a log hook that pulls `trace.getActiveSpan()` ids into log fields.
- Jaeger accepts OTLP/HTTP on `:4318` (compose). Set `OTEL_EXPORTER_OTLP_ENDPOINT`.
- Sentry = Adapter: thin `infra/telemetry/sentry.ts` init + `captureException`; Fastify `setErrorHandler` forwards 5xx to Sentry.

## Requirements

**Functional:** `/metrics` scraped by Prometheus; one trace in Jaeger spans HTTP→pg→publish→consume→smtp; unhandled errors appear in Sentry (if DSN set).
**Non-functional:** observability optional (no DSN/endpoint → no crash, just disabled).

## Architecture

```
preload otel.ts → NodeSDK(httpInstr, pgInstr, amqplibInstr, OTLP→jaeger:4318)
app.ts: fastify-metrics → /metrics ; setErrorHandler → Sentry.captureException
worker: same preload → consume span auto-linked to publish span (traceparent header)
log hook: inject {trace_id, span_id, reqId} into every log line
```

## Related Code Files

**Create:**

- `src/infra/telemetry/otel.ts` (NodeSDK init; imported via `--import`/`-r` preload)
- `src/infra/telemetry/sentry.ts` (Adapter: init + captureException)
- `src/plugins/metrics.ts` (register `fastify-metrics`)
- `src/infra/telemetry/log-trace-context.ts` (helper to merge trace ids into logs)
  **Modify:** `src/app.ts` (register metrics, setErrorHandler→Sentry), `src/server.ts` & `src/workers/email-worker.ts` (preload otel), `package.json` scripts (add `--import ./dist/infra/telemetry/otel.js` / tsx `--import`), `docker-compose` already has jaeger.

## Implementation Steps

1. Install: `@opentelemetry/sdk-node @opentelemetry/auto-instrumentations-node @opentelemetry/exporter-trace-otlp-http @opentelemetry/instrumentation-amqplib @opentelemetry/instrumentation-pg @opentelemetry/instrumentation-http fastify-metrics @sentry/node`.
2. **otel.ts**:
   ```ts
   import { NodeSDK } from '@opentelemetry/sdk-node';
   import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
   import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
   import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';
   import { AmqplibInstrumentation } from '@opentelemetry/instrumentation-amqplib';
   const sdk = new NodeSDK({
     serviceName: process.env.OTEL_SERVICE_NAME ?? 'order-api',
     traceExporter: new OTLPTraceExporter({
       url: `${process.env.OTEL_EXPORTER_OTLP_ENDPOINT}/v1/traces`,
     }),
     instrumentations: [
       new HttpInstrumentation(),
       new PgInstrumentation(),
       new AmqplibInstrumentation(),
     ],
   });
   if (process.env.OTEL_EXPORTER_OTLP_ENDPOINT) sdk.start(); // opt-in
   ```
   Preload BEFORE app: `node --import ./dist/infra/telemetry/otel.js dist/server.js`. Dev: `tsx --import ./src/infra/telemetry/otel.ts watch src/server.ts`.
3. **metrics plugin**: `app.register(fastifyMetrics, { endpoint: '/metrics' })` → default RED metrics + http histogram. Confirm Prometheus scrapes `api:3000/metrics` (phase 02 config).
4. **sentry.ts** Adapter:
   ```ts
   import * as Sentry from '@sentry/node';
   export function initSentry() {
     if (process.env.SENTRY_DSN) Sentry.init({ dsn: process.env.SENTRY_DSN, tracesSampleRate: 0 });
   }
   export const captureError = (e: unknown) => {
     if (process.env.SENTRY_DSN) Sentry.captureException(e);
   };
   ```
   In app.ts: `app.setErrorHandler((err, req, reply) => { if (reply.statusCode >= 500 || !err.statusCode) captureError(err); reply.send(err); });` (still let sensible format).
5. **log-trace-context.ts**: read `trace.getActiveSpan()?.spanContext()` → `{ trace_id, span_id }`; add to Pino logs via Fastify log child or `mixin`. Combine with `reqId`.
6. **Verify propagation:** POST /orders, open Jaeger :16686, find single trace `order-api` → spans: HTTP POST → pg insert (tx) → amqp publish → (worker service) amqp consume → pg insert processed → smtp send. Confirm same `trace_id`.
7. Worker uses same preload + `OTEL_SERVICE_NAME=email-worker` so Jaeger shows two services in one trace.

## Todo

- [ ] install OTel + sentry + fastify-metrics deps
- [ ] otel.ts NodeSDK (http, pg, amqplib) OTLP→jaeger, opt-in
- [ ] preload otel in server + worker (scripts + Dockerfile CMD)
- [ ] metrics plugin /metrics; verify Prometheus scrape + Grafana
- [ ] sentry adapter init + setErrorHandler capture
- [ ] log-trace-context: trace_id/span_id/reqId in logs
- [ ] verify single cross-service trace in Jaeger (publish→consume)

## Success Criteria

- `/metrics` returns Prometheus text; Grafana can graph RPS/latency.
- ONE Jaeger trace spans API + email-worker (traceparent propagated via RabbitMQ).
- 5xx errors captured in Sentry when DSN set; absence of DSN/endpoint = no crash.
- Logs contain `reqId` + `trace_id`.

## Risk Assessment

- OTel preload ordering — if app imported before SDK.start, instrumentation misses libs. Enforce `--import` preload. Common pitfall.
- amqplib instrumentation version must match amqplib major. Verify via context7/npm at install.

## Security Considerations

- Don't export PII in span attributes (mask email). Sentry `sendDefaultPii: false`.

## Next Steps

Phase 10 CI runs typecheck/tests; observability not gating CI but Dockerfile CMD updated to preload otel.
