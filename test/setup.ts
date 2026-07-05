import { readContainerEnv } from '@test/helpers/container-env';

const env = readContainerEnv();

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';
process.env.DATABASE_URL = env.databaseUrl;
process.env.RABBITMQ_URL = env.rabbitmqUrl;
process.env.REDIS_URL = env.redisUrl;
process.env.SMTP_HOST = env.smtpHost;
process.env.SMTP_PORT = env.smtpPort;
process.env.MAILPIT_HTTP = env.mailpitHttp;
process.env.JWT_SECRET ??= 'test-jwt-secret-at-least-32-characters-long';
process.env.WEBHOOK_HMAC_SECRET ??= 'test-webhook-hmac-secret-at-least-32-chars';
process.env.OUTBOX_POLL_INTERVAL_MS ??= '500';
process.env.RATE_LIMIT_MAX ??= '100000';
