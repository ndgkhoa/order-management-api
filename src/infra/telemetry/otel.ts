// OpenTelemetry preload. Loaded via `--import` so the SDK starts BEFORE instrumented
// libraries (http, fastify, pg, amqplib) are imported. Opt-in via OTEL_EXPORTER_OTLP_ENDPOINT.
// Runs before the entrypoint's env-loader, so it loads .env itself.
//
// Uses the low-level provider setup (not NodeSDK) so we EXPLICITLY register the global
// AsyncLocalStorage context manager before instrumentations hook — this is what makes
// `context.active()` carry the request span into the pg/amqp spans (proper nesting).
import type { ReadableSpan, SpanProcessor, Span } from '@opentelemetry/sdk-trace-base';
import type { Context as ApiContext } from '@opentelemetry/api';

try {
  process.loadEnvFile('.env');
} catch {
  // rely on the real environment
}

const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
if (endpoint) {
  const { NodeTracerProvider } = await import('@opentelemetry/sdk-trace-node');
  const { BatchSpanProcessor } = await import('@opentelemetry/sdk-trace-base');
  const { OTLPTraceExporter } = await import('@opentelemetry/exporter-trace-otlp-http');
  const { registerInstrumentations } = await import('@opentelemetry/instrumentation');
  const { AsyncLocalStorageContextManager } = await import('@opentelemetry/context-async-hooks');
  const { resourceFromAttributes } = await import('@opentelemetry/resources');
  const { isSpanContextValid } = await import('@opentelemetry/api');
  const { ATTR_SERVICE_NAME } = await import('@opentelemetry/semantic-conventions');
  const { HttpInstrumentation } = await import('@opentelemetry/instrumentation-http');
  // fastify v5: the OTel auto-instrumentation can't patch the ESM factory, so use the
  // official @fastify/otel plugin. registerOnInitialization auto-hooks every Fastify()
  // → no app.ts change needed; it emits the per-route "request"/"handler" spans.
  const { FastifyOtelInstrumentation } = await import('@fastify/otel');
  const { PgInstrumentation } = await import('@opentelemetry/instrumentation-pg');
  const { AmqplibInstrumentation } = await import('@opentelemetry/instrumentation-amqplib');

  const serviceName =
    process.env.OTEL_SERVICE_NAME ??
    (process.argv.some((a) => a.includes('email-worker')) ? 'email-worker' : 'order-api');

  // Drop the outbox relay's every-tick poll bookkeeping: pg spans with NO parent.
  // The relay polls the DB once per interval outside any request context, so each
  // BEGIN/SELECT/COMMIT/connect becomes an orphan root span → floods Jaeger with
  // single-span traces. Request/worker pg queries always run under a parent span, so
  // they're kept. (pg instrumentation ignores `suppressTracing`, and ALS doesn't carry
  // a wrapper span into drizzle's pool queries — so filtering at export is the reliable
  // lever. The resumed publish keeps the request as parent, so it's never an orphan.)
  const PG_SCOPE = '@opentelemetry/instrumentation-pg';
  // "root" = no parent OR an all-zero/invalid parent context (which Jaeger also renders
  // as a root). Both forms occur for the relay's out-of-request poll queries.
  const hasValidParent = (span: ReadableSpan): boolean => {
    const s = span as {
      parentSpanContext?: { traceId?: string; spanId?: string; traceFlags?: number };
      parentSpanId?: string;
    };
    const pc = s.parentSpanContext;
    if (pc && typeof pc.traceId === 'string' && typeof pc.spanId === 'string') {
      return isSpanContextValid({
        traceId: pc.traceId,
        spanId: pc.spanId,
        traceFlags: pc.traceFlags ?? 0,
      });
    }
    return typeof s.parentSpanId === 'string' && s.parentSpanId !== '0000000000000000';
  };
  const wrapWithFilter = (inner: SpanProcessor): SpanProcessor => ({
    onStart: (span: Span, ctx: ApiContext) => inner.onStart(span, ctx),
    onEnd: (span: ReadableSpan) => {
      if (span.instrumentationScope.name === PG_SCOPE && !hasValidParent(span)) return; // drop orphan poll span
      inner.onEnd(span);
    },
    forceFlush: () => inner.forceFlush(),
    shutdown: () => inner.shutdown(),
  });

  const provider = new NodeTracerProvider({
    resource: resourceFromAttributes({ [ATTR_SERVICE_NAME]: serviceName }),
    spanProcessors: [
      wrapWithFilter(
        new BatchSpanProcessor(new OTLPTraceExporter({ url: `${endpoint}/v1/traces` })),
      ),
    ],
  });

  // register() sets the GLOBAL tracer provider, context manager and propagator.
  provider.register({ contextManager: new AsyncLocalStorageContextManager() });

  registerInstrumentations({
    instrumentations: [
      new HttpInstrumentation(), // root server span per request
      new FastifyOtelInstrumentation({ registerOnInitialization: true }), // route/handler spans (service.name from resource)
      new PgInstrumentation(),
      new AmqplibInstrumentation(), // traceparent into AMQP headers → cross-service trace
    ],
  });

  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => void provider.shutdown());
  }
}
