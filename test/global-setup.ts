import { writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { GenericContainer, Wait } from 'testcontainers';
import { runMigrations } from '@infra/db/migrate.js';
import { ENV_FILE, type TestContainerEnv } from '@test/helpers/container-env.js';

/**
 * Starts the real backing services ONCE for the whole suite (no mocks — see phase 09):
 * Postgres (migrated), RabbitMQ, Mailpit. Container URLs are written to a temp file that
 * setup.ts reads inside each worker. Containers are torn down in the returned teardown.
 */
export default async function setup(): Promise<() => Promise<void>> {
  const pg = await new PostgreSqlContainer('postgres:18.3').start();
  await runMigrations(pg.getConnectionUri());

  const rabbit = await new GenericContainer('rabbitmq:4.2.5-management')
    .withExposedPorts(5672)
    .withWaitStrategy(Wait.forLogMessage('Server startup complete'))
    .withStartupTimeout(120_000)
    .start();

  const mailpit = await new GenericContainer('axllent/mailpit:v1.30.1')
    .withExposedPorts(1025, 8025)
    .start();

  const env: TestContainerEnv = {
    databaseUrl: pg.getConnectionUri(),
    rabbitmqUrl: `amqp://${rabbit.getHost()}:${rabbit.getMappedPort(5672)}`,
    smtpHost: mailpit.getHost(),
    smtpPort: String(mailpit.getMappedPort(1025)),
    mailpitHttp: `http://${mailpit.getHost()}:${mailpit.getMappedPort(8025)}`,
  };
  mkdirSync(dirname(ENV_FILE), { recursive: true }); // ensure node_modules/.cache exists
  writeFileSync(ENV_FILE, JSON.stringify(env));

  return async () => {
    rmSync(ENV_FILE, { force: true });
    await Promise.allSettled([pg.stop(), rabbit.stop(), mailpit.stop()]);
  };
}
