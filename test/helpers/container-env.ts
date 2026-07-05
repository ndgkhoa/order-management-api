import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const ENV_FILE = join(
  process.cwd(),
  'node_modules',
  '.cache',
  'order-management-api-test-env.json',
);

export interface TestContainerEnv {
  databaseUrl: string;
  rabbitmqUrl: string;
  redisUrl: string;
  smtpHost: string;
  smtpPort: string;
  mailpitHttp: string;
}

export function readContainerEnv(): TestContainerEnv {
  return JSON.parse(readFileSync(ENV_FILE, 'utf8')) as TestContainerEnv;
}
