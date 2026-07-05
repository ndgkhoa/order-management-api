import * as Sentry from '@sentry/node';

export function initSentry(): void {
  if (process.env.SENTRY_DSN) {
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      environment: process.env.NODE_ENV ?? 'development',
      sendDefaultPii: false,
      skipOpenTelemetrySetup: true,
    });
  }
}

export function captureError(err: unknown): void {
  if (process.env.SENTRY_DSN) {
    Sentry.captureException(err);
  }
}
