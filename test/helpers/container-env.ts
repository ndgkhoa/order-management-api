import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Cross-process channel between globalSetup (main process, starts containers) and
 * setupFiles (test worker, must set process.env BEFORE the app's db singleton is
 * imported). globalSetup writes the resolved container URLs here; setup.ts reads
 * them synchronously in the worker. A file is the most reliable channel because env
 * mutations and module globals do NOT cross the globalSetup → worker boundary.
 *
 * Kept under the project's node_modules/.cache (user-owned, gitignored) — NOT the OS
 * temp dir, which is world-readable and uses a predictable name (insecure temp file).
 * The path is deterministic so both processes agree on it without coordination.
 */
export const ENV_FILE = join(
  process.cwd(),
  'node_modules',
  '.cache',
  'fastify-drizzle-test-env.json',
);

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
