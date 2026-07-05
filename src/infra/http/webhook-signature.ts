import { createHmac, timingSafeEqual } from 'node:crypto';

// HMAC verified over the EXACT raw request bytes, never a reserialized body.
export function signWebhook(secret: string, rawBody: string): string {
  return createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
}

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

export function isFreshTimestamp(timestampMs: number, skewMs: number, now = Date.now()): boolean {
  return Math.abs(now - timestampMs) <= skewMs;
}
