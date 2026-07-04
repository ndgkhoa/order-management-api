import { randomUUID } from 'node:crypto';

/**
 * Versioned envelope wrapping every outbox event published to RabbitMQ. Carrying a
 * logical `eventId` (stable across re-emits) + `correlationId` (= aggregate/order id)
 * makes every saga event dedupe-able and traceable end to end. The relay builds it
 * from the outbox row at publish time; consumers read `eventId` for idempotency.
 */
export interface EventEnvelope<T = unknown> {
  eventId: string;
  eventType: string;
  correlationId: string;
  occurredAt: string; // ISO 8601
  payload: T;
}

interface CreateEnvelopeInput<T> {
  eventType: string;
  correlationId: string;
  payload: T;
  eventId?: string; // defaults to a fresh uuid; pass the stored outbox event_id to keep it stable
  occurredAt?: Date;
}

/** Builds an EventEnvelope, defaulting `eventId` and `occurredAt` when not supplied. */
export function buildEventEnvelope<T>({
  eventType,
  correlationId,
  payload,
  eventId = randomUUID(),
  occurredAt = new Date(),
}: CreateEnvelopeInput<T>): EventEnvelope<T> {
  return { eventId, eventType, correlationId, occurredAt: occurredAt.toISOString(), payload };
}
