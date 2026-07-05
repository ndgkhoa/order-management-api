try {
  process.loadEnvFile('.env');
} catch {
  // no .env; use real environment
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
  const { FastifyOtelInstrumentation } = await import('@fastify/otel');
  const { PgInstrumentation } = await import('@opentelemetry/instrumentation-pg');
  const { AmqplibInstrumentation } = await import('@opentelemetry/instrumentation-amqplib');

  const resource = defaultResource().merge(
    detectResources({ detectors: [envDetector, hostDetector, processDetector] }),
  );

  const provider = new NodeTracerProvider({
    resource,
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

  provider.register({ contextManager: new AsyncLocalStorageContextManager() });

  registerInstrumentations({
    instrumentations: [
      new HttpInstrumentation(),
      new FastifyOtelInstrumentation({ registerOnInitialization: true }),
      new PgInstrumentation(),
      new AmqplibInstrumentation(),
    ],
  });

  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => void provider.shutdown());
  }
}
