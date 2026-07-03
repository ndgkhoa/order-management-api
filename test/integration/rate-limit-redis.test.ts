import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import type { AppInstance } from '@/app.js';
import { buildTestApp } from '@test/helpers/build-test-app.js';

/**
 * Rate limiting must be backed by Redis (not per-process memory) so the counter is
 * shared across instances. We prove both properties: a request creates a counter key
 * in Redis, and once that shared counter exceeds the limit the next request is 429'd —
 * regardless of which instance served the earlier requests.
 */
describe('rate limiting (redis store)', () => {
  let app: AppInstance;
  const RL_PREFIX = 'fastify-rate-limit-*';

  beforeAll(async () => {
    app = await buildTestApp();
  });

  beforeEach(async () => {
    // clear any counters left by other suites so this test is deterministic
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
    await app.inject({ method: 'GET', url: '/health' }); // create the counter key
    const keys = await app.redis.keys(RL_PREFIX);
    expect(keys.length).toBeGreaterThan(0);

    // simulate other instances having already exhausted the shared budget
    await Promise.all(keys.map((k) => app.redis.set(k, '1000000000', 'KEEPTTL')));

    const limited = await app.inject({ method: 'GET', url: '/health' });
    expect(limited.statusCode).toBe(429);
  });
});
