import { describe, it, expect } from 'vitest';
import { buildEventEnvelope } from '@infra/mq/event-envelope.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe('buildEventEnvelope', () => {
  it('defaults a uuid eventId + ISO occurredAt and passes through the rest', () => {
    const env = buildEventEnvelope({
      eventType: 'order.created',
      correlationId: 'order-1',
      payload: { a: 1 },
    });

    expect(env.eventId).toMatch(UUID_RE);
    expect(env.occurredAt).toBe(new Date(env.occurredAt).toISOString()); // round-trips → valid ISO
    expect(env.eventType).toBe('order.created');
    expect(env.correlationId).toBe('order-1');
    expect(env.payload).toEqual({ a: 1 });
  });

  it('uses a supplied eventId + occurredAt (stable across re-emits)', () => {
    const when = new Date('2026-01-01T00:00:00.000Z');
    const env = buildEventEnvelope({
      eventType: 'x',
      correlationId: 'c',
      payload: null,
      eventId: 'fixed-id',
      occurredAt: when,
    });

    expect(env.eventId).toBe('fixed-id');
    expect(env.occurredAt).toBe('2026-01-01T00:00:00.000Z');
  });
});
