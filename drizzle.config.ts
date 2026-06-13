import { defineConfig } from 'drizzle-kit';

// Load .env for local CLI runs (generate/migrate/studio). In CI/prod the env is
// already set, so a missing .env is fine. process.loadEnvFile is native to Node 24.
try {
  process.loadEnvFile('.env');
} catch {
  // no .env present — rely on the real environment
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/infra/db/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? '',
  },
});
