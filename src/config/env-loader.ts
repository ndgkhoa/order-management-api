try {
  process.loadEnvFile('.env');
} catch {
  // no .env; use real environment
}
