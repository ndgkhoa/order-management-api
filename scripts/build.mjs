import { build } from 'esbuild';

// Build the runtime entrypoints: esbuild transpiles + resolves the `@` path aliases
// (from tsconfig `paths`, no baseUrl) and emits to dist. Replaces tsc emit + tsc-alias.
//
// - `packages: 'external'` keeps node_modules out of the bundle (the runner resolves them
//   from the pruned prod node_modules); only our own code + `@` aliases are inlined.
// - `splitting` + ESM factor shared internal modules (schema, db, mq, …) into chunk files
//   instead of duplicating them into every entry.
// - `outbase: 'src'` strips the src/ prefix so outputs land at dist/server.js,
//   dist/workers/worker.js, dist/infra/telemetry/otel.js, dist/infra/db/migrate.js —
//   the paths the compose commands and the `--import` preload expect.
await build({
  entryPoints: [
    'src/server.ts', // API
    'src/workers/worker.ts', // background worker (consumers + relay + reaper)
    'src/infra/telemetry/otel.ts', // OTel preload (node --import)
    'src/infra/db/migrate.ts', // one-shot deploy migration
  ],
  outdir: 'dist',
  outbase: 'src',
  bundle: true,
  splitting: true,
  format: 'esm',
  platform: 'node',
  target: 'node24',
  packages: 'external',
  sourcemap: true,
  logLevel: 'info',
});
