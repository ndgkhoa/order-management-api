import { Type, type Static } from '@sinclair/typebox';

/**
 * 12-Factor config: the single source of truth for environment variables.
 * Validated at boot by `@fastify/env` (AJV). Missing/invalid env aborts startup
 * with a clear error. Modules read `fastify.config`, never `process.env` directly.
 */
export const envSchema = Type.Object({
  NODE_ENV: Type.Union(
    [Type.Literal('development'), Type.Literal('production'), Type.Literal('test')],
    { default: 'development' },
  ),
  PORT: Type.Number({ default: 3000 }),
  LOG_LEVEL: Type.String({ default: 'info' }),

  DATABASE_URL: Type.String({ minLength: 1 }),
  RABBITMQ_URL: Type.String({ minLength: 1 }),
  REDIS_URL: Type.String({ minLength: 1 }),

  JWT_SECRET: Type.String({ minLength: 32 }),
  JWT_EXPIRES_IN: Type.String({ default: '15m' }),

  // Shared secret the mock payment provider signs webhooks with and the webhook
  // route verifies (phase 6). Declared now so boot validation covers it early.
  WEBHOOK_HMAC_SECRET: Type.String({ minLength: 32 }),

  // Mock payment provider (phase 6): delay before it calls the webhook back, the URL it
  // posts the signed result to, and the max clock skew a webhook timestamp may drift.
  MOCK_PAYMENT_DELAY_MS: Type.Number({ default: 2000 }),
  PAYMENT_WEBHOOK_URL: Type.String({ default: 'http://localhost:3000/webhooks/payment' }),
  WEBHOOK_TIMESTAMP_SKEW_MS: Type.Number({ default: 300_000 }), // 5 min

  // Fake shipping worker: delay between each shipment status advance.
  SHIPPING_STEP_MS: Type.Number({ default: 3000 }),

  SMTP_HOST: Type.String({ default: 'localhost' }),
  SMTP_PORT: Type.Number({ default: 1025 }),
  MAIL_FROM: Type.String({ default: 'no-reply@orders.local' }),

  OUTBOX_POLL_INTERVAL_MS: Type.Number({ default: 1000 }),

  // Redis-backed rate limit (shared across instances). Configurable so tests can raise
  // the ceiling without tripping on the shared client IP.
  RATE_LIMIT_MAX: Type.Number({ default: 100 }),
  RATE_LIMIT_TIME_WINDOW: Type.String({ default: '1 minute' }),

  // Stuck-order reaper (worker): how often to sweep, and how old a `pending` order must be
  // to be flagged as stuck (default 15 min).
  ORDER_REAPER_INTERVAL_MS: Type.Number({ default: 60_000 }),
  STUCK_ORDER_THRESHOLD_MS: Type.Number({ default: 900_000 }),

  OTEL_EXPORTER_OTLP_ENDPOINT: Type.Optional(Type.String()),
  SENTRY_DSN: Type.Optional(Type.String()),
});

export type AppConfig = Static<typeof envSchema>;
