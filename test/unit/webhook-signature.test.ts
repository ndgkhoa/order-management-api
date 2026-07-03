import { describe, it, expect } from 'vitest';
import {
  signWebhook,
  verifyWebhook,
  isFreshTimestamp,
} from '@modules/payments/webhook-signature.js';

const SECRET = 'test-webhook-hmac-secret-at-least-32-chars';

describe('webhook signature', () => {
  const rawBody = JSON.stringify({ providerEventId: 'e1', paymentId: 'p1', outcome: 'SUCCEEDED' });

  it('verifies a signature produced over the exact raw bytes', () => {
    const sig = signWebhook(SECRET, rawBody);
    expect(verifyWebhook(SECRET, rawBody, sig)).toBe(true);
  });

  it('rejects a tampered body (re-serialized bytes differ from the signed bytes)', () => {
    const sig = signWebhook(SECRET, rawBody);
    // Same logical object, but a re-serialized/altered byte string must fail — proves the
    // test is not signing and verifying the same mutable object.
    const reserialized = JSON.stringify({
      outcome: 'SUCCEEDED',
      paymentId: 'p1',
      providerEventId: 'e1',
    });
    expect(reserialized).not.toBe(rawBody);
    expect(verifyWebhook(SECRET, reserialized, sig)).toBe(false);
  });

  it('rejects a tampered signature', () => {
    const sig = signWebhook(SECRET, rawBody);
    expect(verifyWebhook(SECRET, rawBody, sig.slice(0, -2) + '00')).toBe(false);
  });

  it('rejects a wrong-length signature without throwing (timing-safe compare)', () => {
    expect(verifyWebhook(SECRET, rawBody, 'deadbeef')).toBe(false);
  });

  it('rejects a signature made with a different secret', () => {
    const sig = signWebhook('another-secret-at-least-32-characters-x', rawBody);
    expect(verifyWebhook(SECRET, rawBody, sig)).toBe(false);
  });
});

describe('webhook timestamp freshness', () => {
  const now = 1_000_000_000_000;
  const skew = 300_000; // 5 min

  it('accepts a timestamp within the skew window', () => {
    expect(isFreshTimestamp(now - 10_000, skew, now)).toBe(true);
    expect(isFreshTimestamp(now + 10_000, skew, now)).toBe(true);
  });

  it('rejects a stale timestamp beyond the skew window (replay defense)', () => {
    expect(isFreshTimestamp(now - skew - 1, skew, now)).toBe(false);
  });
});
