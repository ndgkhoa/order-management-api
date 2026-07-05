import { writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { GenericContainer, Wait } from 'testcontainers';
import { runMigrations } from '@infra/db/migrate';
import { ENV_FILE, type TestContainerEnv } from '@test/helpers/container-env';

export default async function setup(): Promise<() => Promise<void>> {
  const pg = await new PostgreSqlContainer('postgres:18.4').start();
  await runMigrations(pg.getConnectionUri());

  const rabbit = await new GenericContainer('rabbitmq:4.3.2-management')
    .withExposedPorts(5672)
    .withWaitStrategy(Wait.forLogMessage('Server startup complete'))
    .withStartupTimeout(120_000)
    .start();

  const redis = await new GenericContainer('redis:8.8.0')
    .withExposedPorts(6379)
    .withWaitStrategy(Wait.forLogMessage('Ready to accept connections'))
    .start();

  const mailpit = await new GenericContainer('axllent/mailpit:v1.30.1')
    .withExposedPorts(1025, 8025)
    .start();

  const env: TestContainerEnv = {
    databaseUrl: pg.getConnectionUri(),
    rabbitmqUrl: `amqp://${rabbit.getHost()}:${rabbit.getMappedPort(5672)}`,
    redisUrl: `redis://${redis.getHost()}:${redis.getMappedPort(6379)}`,
    smtpHost: mailpit.getHost(),
    smtpPort: String(mailpit.getMappedPort(1025)),
    mailpitHttp: `http://${mailpit.getHost()}:${mailpit.getMappedPort(8025)}`,
  };
  mkdirSync(dirname(ENV_FILE), { recursive: true });
  writeFileSync(ENV_FILE, JSON.stringify(env));

  return async () => {
    rmSync(ENV_FILE, { force: true });
    await Promise.allSettled([pg.stop(), rabbit.stop(), redis.stop(), mailpit.stop()]);
  };
}
