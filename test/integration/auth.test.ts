import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import type { AppInstance } from '@/app';
import { buildTestApp } from '@test/helpers/build-test-app';
import { resetDb } from '@test/helpers/reset-db';

describe('auth API', () => {
  let app: AppInstance;
  beforeAll(async () => {
    app = await buildTestApp();
  });
  beforeEach(resetDb);

  const creds = { email: 'auth@test.dev', password: 'password1234' };

  it('registers a new user → 201', async () => {
    const res = await app.inject({ method: 'POST', url: '/auth/register', payload: creds });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ email: creds.email });
    expect(res.json()).not.toHaveProperty('passwordHash');
  });

  it('rejects a duplicate registration → 409', async () => {
    await app.inject({ method: 'POST', url: '/auth/register', payload: creds });
    const res = await app.inject({ method: 'POST', url: '/auth/register', payload: creds });
    expect(res.statusCode).toBe(409);
  });

  it('logs in with valid credentials → 200 + accessToken', async () => {
    await app.inject({ method: 'POST', url: '/auth/register', payload: creds });
    const res = await app.inject({ method: 'POST', url: '/auth/login', payload: creds });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ accessToken: string }>().accessToken).toBeTypeOf('string');
  });

  it('rejects an invalid body → 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: 'not-an-email', password: 'short' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects a wrong password → 401', async () => {
    await app.inject({ method: 'POST', url: '/auth/register', payload: creds });
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: creds.email, password: 'wrong-password' },
    });
    expect(res.statusCode).toBe(401);
  });
});
