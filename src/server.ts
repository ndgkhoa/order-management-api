import { buildApp } from './app.js';

/**
 * Process entrypoint: listen + (phase 04) graceful shutdown on SIGTERM/SIGINT.
 * NodeNext ESM requires the explicit `.js` extension on relative imports.
 */
async function main(): Promise<void> {
  const app = await buildApp();
  const port = Number(process.env.PORT ?? 3000);
  await app.listen({ port, host: '0.0.0.0' });
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
