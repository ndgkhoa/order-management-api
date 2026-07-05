import { build } from 'esbuild';

await build({
  entryPoints: [
    'src/server.ts',
    'src/workers/worker.ts',
    'src/infra/telemetry/otel.ts',
    'src/infra/db/migrate.ts',
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
