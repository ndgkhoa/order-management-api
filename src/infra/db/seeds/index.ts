import '@config/env-loader.js';
import { closePool } from '@infra/db/pool.js';
import { seedAdmin } from '@infra/db/seeds/seed-admin.js';

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
