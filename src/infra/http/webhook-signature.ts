import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * HMAC-SHA256 webhook signing/verification over the EXACT raw request bytes. Signing the
 * parsed-then-reserialized body would drift from the provider's bytes (key order, spacing,
 * number formatting) and falsely mismatch — so both sides must operate on the raw string.
 */
export function signWebhook(secret: string, rawBody: string): string {
  return createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
}

/** Timing-safe verification. A malformed/wrong-length signature returns false, never throws. */
export function verifyWebhook(secret: string, rawBody: string, signature: string): boolean {
  const expected = Buffer.from(signWebhook(secret, rawBody), 'hex');
  let provided: Buffer;
  try {
    provided = Buffer.from(signature, 'hex');
  } catch {
    return false;
  }
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}

/**
 * Replay defense: the signed payload carries a `timestamp` (epoch ms); reject deliveries whose
 * clock drift exceeds `skewMs` so a captured valid body can't be replayed after the dedup TTL.
 */
export function isFreshTimestamp(timestampMs: number, skewMs: number, now = Date.now()): boolean {
  return Math.abs(now - timestampMs) <= skewMs;
}
