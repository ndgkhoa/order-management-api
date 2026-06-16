// OpenTelemetry preload. Loaded via `--import` so the SDK starts BEFORE instrumented
// libraries (http, fastify, pg, amqplib) are imported. Opt-in via OTEL_EXPORTER_OTLP_ENDPOINT.
// Runs before the entrypoint's env-loader, so it loads .env itself.
//
// Uses the low-level provider setup (not NodeSDK) so we EXPLICITLY register the global
// AsyncLocalStorage context manager before instrumentations hook — this is what makes
// `context.active()` carry the request span into the pg/amqp spans (proper nesting).

try {
  process.loadEnvFile('.env');
} catch {
  // rely on the real environment
}

const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
if (endpoint) {
  const { NodeTracerProvider } = await import('@opentelemetry/sdk-trace-node');
  const { BatchSpanProcessor, ParentBasedSampler, SamplingDecision } =
    await import('@opentelemetry/sdk-trace-base');
  const { OTLPTraceExporter } = await import('@opentelemetry/exporter-trace-otlp-http');
  const { registerInstrumentations } = await import('@opentelemetry/instrumentation');
  const { AsyncLocalStorageContextManager } = await import('@opentelemetry/context-async-hooks');
  const { detectResources, defaultResource, envDetector, hostDetector, processDetector } =
    await import('@opentelemetry/resources');
  const { SpanKind } = await import('@opentelemetry/api');
  const { HttpInstrumentation } = await import('@opentelemetry/instrumentation-http');
  // fastify v5: the OTel auto-instrumentation can't patch the ESM factory, so use the
  // official @fastify/otel plugin. registerOnInitialization auto-hooks every Fastify()
  // → no app.ts change needed; it emits the per-route "request"/"handler" spans.
  const { FastifyOtelInstrumentation } = await import('@fastify/otel');
  const { PgInstrumentation } = await import('@opentelemetry/instrumentation-pg');
  const { AmqplibInstrumentation } = await import('@opentelemetry/instrumentation-amqplib');

  // service.name is a deployment concern, not app code: envDetector reads the standard
  // OTEL_SERVICE_NAME / OTEL_RESOURCE_ATTRIBUTES vars (set per-process in compose + npm
  // scripts), host/process detectors add host.*/process.* context. defaultResource supplies
  // telemetry.sdk.* and the unknown_service fallback; detected attrs merge on top and win —
  // so a misconfigured process surfaces as "unknown_service" instead of silently mislabeling.
  const resource = defaultResource().merge(
    detectResources({ detectors: [envDetector, hostDetector, processDetector] }),
  );

  const provider = new NodeTracerProvider({
    resource,
    // Drop the outbox relay's every-tick poll bookkeeping. The relay polls the DB once per
    // interval OUTSIDE any request/consume context, so each BEGIN/SELECT/UPDATE/COMMIT becomes
    // an orphan ROOT span → floods Jaeger with single-span traces. ParentBasedSampler is the
    // OTel-native lever: spans WITH a parent (request/worker queries, the resumed relay publish)
    // follow the parent and are kept; only ROOT spans reach the `root` sampler below, where we
    // drop the DB ones. Replaces the old export-time processor filter that reached into internal
    // span fields. ParentBasedSampler also treats an all-zero/invalid parent as root, so those
    // poll queries are covered too.
    sampler: new ParentBasedSampler({
      root: {
        shouldSample(_context, _traceId, _spanName, spanKind, attributes) {
          const isDbSpan = 'db.system' in attributes || 'db.system.name' in attributes;
          return spanKind === SpanKind.CLIENT || isDbSpan
            ? { decision: SamplingDecision.NOT_RECORD }
            : { decision: SamplingDecision.RECORD_AND_SAMPLED };
        },
        toString: () => 'DropOrphanDbRootSampler',
      },
    }),
    spanProcessors: [
      new BatchSpanProcessor(new OTLPTraceExporter({ url: `${endpoint}/v1/traces` })),
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
