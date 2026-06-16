import { readContainerEnv } from '@test/helpers/container-env.js';

/**
 * Runs in each test worker BEFORE any test module (and therefore before the app's db
 * pool singleton) is imported. Sets process.env from the container URLs so the singleton
 * pool, @fastify/jwt and the mailer all bind to the real test containers.
 */
const env = readContainerEnv();

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent'; // keep test output clean
process.env.DATABASE_URL = env.databaseUrl;
process.env.RABBITMQ_URL = env.rabbitmqUrl;
process.env.SMTP_HOST = env.smtpHost;
process.env.SMTP_PORT = env.smtpPort;
process.env.MAILPIT_HTTP = env.mailpitHttp;
process.env.JWT_SECRET ??= 'test-jwt-secret-at-least-32-characters-long';
process.env.OUTBOX_POLL_INTERVAL_MS ??= '500';
