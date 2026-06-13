// Side-effect module: load `.env` BEFORE any other module reads process.env
// (e.g. the db pool reads DATABASE_URL at import time). Must be the FIRST import
// in each entrypoint (server.ts, workers/*). No-op when .env is absent (containers/CI
// inject real env). process.loadEnvFile is native to Node 24.
try {
  process.loadEnvFile('.env');
} catch {
  // .env not present — rely on the real environment
}
