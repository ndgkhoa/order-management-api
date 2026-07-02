import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { tsconfigPaths: true }, // resolve @/, @infra/, @modules/ ... aliases (native, Vitest 4)
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts'],
    globalSetup: ['test/global-setup.ts'], // start pg/rabbit/mailpit once
    setupFiles: ['test/setup.ts'], // set process.env per worker before app import
    // One process, sequential, shared module state: the db pool singleton + containers
    // are reused across files (data isolation is via per-test truncation).
    pool: 'forks',
    fileParallelism: false,
    isolate: false,
    testTimeout: 30_000,
    hookTimeout: 180_000, // first run pulls container images
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.d.ts', 'src/server.ts', 'src/workers/**', 'src/infra/telemetry/**'],
      // `json-summary` feeds the CI PR-comment coverage table; `reportOnFailure` writes it
      // even when a test fails so the comment still renders. `text` keeps the console output.
      reporter: ['text', 'json-summary'],
      reportOnFailure: true,
    },
  },
});
