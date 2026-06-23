import '@config/env-loader.js'; // load .env so the pool reads DATABASE_URL
import { closePool } from '@infra/db/pool.js';
import { seedAdmin } from '@infra/db/seeds/seed-admin.js';

/**
 * Dev seed runner. Register every seeder here; they run in order. Dev/local only.
 * Add a new seeder: create a file in this folder exporting an idempotent async fn,
 * then push it onto `seeders`. Run all with `npm run db:seed`.
 */
const seeders: Array<() => Promise<void>> = [seedAdmin];

async function run(): Promise<void> {
  console.log('seeding…');
  for (const seed of seeders) {
    await seed();
  }
}

run()
  .then(() => closePool())
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
