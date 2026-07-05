import { eq } from 'drizzle-orm';
import { buildApp, type AppInstance } from '@/app.js';
import { db } from '@infra/db/client.js';
import { users } from '@infra/db/schema.js';
import { UserRoles } from '@/types/user-role.js';

let cached: Promise<AppInstance> | undefined;

export function buildTestApp(): Promise<AppInstance> {
  cached ??= buildApp().then(async (app) => {
    await app.ready();
    return app;
  });
  return cached;
}

const DEFAULT_PASSWORD = 'password1234';

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

export async function registerAdminAndLogin(
  app: AppInstance,
  email = `admin-${crypto.randomUUID()}@test.dev`,
  password = DEFAULT_PASSWORD,
): Promise<{ token: string; email: string }> {
  await app.inject({ method: 'POST', url: '/auth/register', payload: { email, password } });
  await db
    .update(users)
    .set({ roles: [UserRoles.Admin] })
    .where(eq(users.email, email));
  const res = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email, password },
  });
  const { accessToken } = res.json<{ accessToken: string }>();
  return { token: accessToken, email };
}
