import { describe, it, expect } from 'vitest';
import { deriveIdempotencyKey } from '@plugins/idempotency.js';

describe('deriveIdempotencyKey', () => {
  it('scopes the key by user, route, and header value', () => {
    expect(deriveIdempotencyKey('user-1', 'POST:/orders', 'abc')).toBe(
      'idem:user-1:POST:/orders:abc',
    );
  });

  it('produces distinct keys for different users (no cross-tenant collision)', () => {
    const a = deriveIdempotencyKey('user-1', 'POST:/orders', 'same-key');
    const b = deriveIdempotencyKey('user-2', 'POST:/orders', 'same-key');
    expect(a).not.toBe(b);
  });

  it('produces distinct keys for different routes', () => {
    const a = deriveIdempotencyKey('user-1', 'POST:/orders', 'same-key');
    const b = deriveIdempotencyKey('user-1', 'POST:/payments', 'same-key');
    expect(a).not.toBe(b);
  });

  it('produces distinct keys for different header values', () => {
    const a = deriveIdempotencyKey('user-1', 'POST:/orders', 'k1');
    const b = deriveIdempotencyKey('user-1', 'POST:/orders', 'k2');
    expect(a).not.toBe(b);
  });
});
