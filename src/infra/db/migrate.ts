import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';

/**
 * Applies all pending SQL migrations from ./drizzle.
 * Used by integration tests (Testcontainers) and as a one-shot deploy/init step.
 * Uses its own single-connection pool so it can run before the app starts.
 */
export async function runMigrations(
  databaseUrl: string | undefined = process.env.DATABASE_URL,
): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  try {
    await migrate(drizzle({ client: pool }), { migrationsFolder: './drizzle' });
  } finally {
    await pool.end();
  }
}

// Run as a script: `node dist/infra/db/migrate.js` (deploy init).
if (import.meta.url === `file://${process.argv[1]}`) {
  runMigrations()
    .then(() => {
      console.log('migrations applied');
      process.exit(0);
    })
    .catch((err: unknown) => {
      console.error(err);
      process.exit(1);
    });
}
