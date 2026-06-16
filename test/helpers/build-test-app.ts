import { buildApp, type AppInstance } from '@/app.js';

// Memoized: the metrics plugin registers default metrics on prom-client's GLOBAL
// registry, so building the app twice in one process throws "already registered".
// Tests run in a single fork, so one shared app is correct (data isolation is via
// resetDb, not separate apps).
let cached: Promise<AppInstance> | undefined;

/** Boots the real Fastify app (no listen) for app.inject() tests; shared across files. */
export function buildTestApp(): Promise<AppInstance> {
  cached ??= buildApp().then(async (app) => {
    await app.ready();
    return app;
  });
  return cached;
}

const DEFAULT_PASSWORD = 'password1234';

/** Registers a user and returns a valid Bearer token for authenticated routes. */
export async function registerAndLogin(
  app: AppInstance,
  email = `user-${crypto.randomUUID()}@test.dev`,
  password = DEFAULT_PASSWORD,
): Promise<{ token: string; email: string }> {
  await app.inject({ method: 'POST', url: '/auth/register', payload: { email, password } });
  const res = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email, password },
  });
  const { accessToken } = res.json<{ accessToken: string }>();
  return { token: accessToken, email };
}
