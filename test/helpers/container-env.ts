import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Cross-process channel between globalSetup (main process, starts containers) and
 * setupFiles (test worker, must set process.env BEFORE the app's db singleton is
 * imported). globalSetup writes the resolved container URLs here; setup.ts reads
 * them synchronously in the worker. A file is the most reliable channel because env
 * mutations and module globals do NOT cross the globalSetup → worker boundary.
 */
export const ENV_FILE = join(tmpdir(), 'fastify-drizzle-test-env.json');

export interface TestContainerEnv {
  databaseUrl: string;
  rabbitmqUrl: string;
  smtpHost: string;
  smtpPort: string;
  mailpitHttp: string;
}

export function readContainerEnv(): TestContainerEnv {
  return JSON.parse(readFileSync(ENV_FILE, 'utf8')) as TestContainerEnv;
}
