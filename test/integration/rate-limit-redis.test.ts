import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import type { AppInstance } from '@/app';
import { buildTestApp } from '@test/helpers/build-test-app';

describe('rate limiting', () => {
  let app: AppInstance;
  const RL_PREFIX = 'fastify-rate-limit-*';

  beforeAll(async () => {
    app = await buildTestApp();
  });

  beforeEach(async () => {
    const keys = await app.redis.keys(RL_PREFIX);
    if (keys.length) await app.redis.del(...keys);
  });

  afterAll(async () => {
    const keys = await app.redis.keys(RL_PREFIX);
    if (keys.length) await app.redis.del(...keys);
  });

  it('stores the request counter in Redis', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);

    const keys = await app.redis.keys(RL_PREFIX);
    expect(keys.length).toBeGreaterThan(0);
  });

  it('rejects with 429 once the shared Redis counter exceeds the limit', async () => {
    await app.inject({ method: 'GET', url: '/health' });
    const keys = await app.redis.keys(RL_PREFIX);
    expect(keys.length).toBeGreaterThan(0);

    await Promise.all(keys.map((k) => app.redis.set(k, '1000000000', 'KEEPTTL')));

    const limited = await app.inject({ method: 'GET', url: '/health' });
    expect(limited.statusCode).toBe(429);
  });
});
