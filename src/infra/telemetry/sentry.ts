import * as Sentry from '@sentry/node';

/** Adapter around Sentry. Opt-in: a missing SENTRY_DSN disables it (no crash). */
export function initSentry(): void {
  if (process.env.SENTRY_DSN) {
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      environment: process.env.NODE_ENV ?? 'development',
      sendDefaultPii: false, // don't leak user data
      // Errors only — our own OpenTelemetry SDK owns tracing. Omitting tracesSampleRate
      // (leaving it undefined) keeps Sentry's tracing OFF, so its default integrations
      // don't emit OTel spans that would duplicate ours. skipOpenTelemetrySetup stops
      // Sentry from installing a competing OTel SDK on top of ours.
      skipOpenTelemetrySetup: true,
    });
  }
}

export function captureError(err: unknown): void {
  if (process.env.SENTRY_DSN) {
    Sentry.captureException(err);
  }
}
