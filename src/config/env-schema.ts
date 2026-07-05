import { Type, type Static } from '@sinclair/typebox';

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

  WEBHOOK_HMAC_SECRET: Type.String({ minLength: 32 }),

  MOCK_PAYMENT_DELAY_MS: Type.Number({ default: 2000 }),
  PAYMENT_WEBHOOK_URL: Type.String({ default: 'http://localhost:3000/webhooks/payment' }),
  WEBHOOK_TIMESTAMP_SKEW_MS: Type.Number({ default: 300_000 }),

  SHIPPING_STEP_MS: Type.Number({ default: 3000 }),

  SMTP_HOST: Type.String({ default: 'localhost' }),
  SMTP_PORT: Type.Number({ default: 1025 }),
  MAIL_FROM: Type.String({ default: 'no-reply@orders.test' }),

  OUTBOX_POLL_INTERVAL_MS: Type.Number({ default: 1000 }),

  RATE_LIMIT_MAX: Type.Number({ default: 100 }),
  RATE_LIMIT_TIME_WINDOW: Type.String({ default: '1 minute' }),

  ORDER_REAPER_INTERVAL_MS: Type.Number({ default: 60_000 }),
  STUCK_ORDER_THRESHOLD_MS: Type.Number({ default: 900_000 }),

  OTEL_EXPORTER_OTLP_ENDPOINT: Type.Optional(Type.String()),
  SENTRY_DSN: Type.Optional(Type.String()),
});

export type AppConfig = Static<typeof envSchema>;
