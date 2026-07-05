import { randomUUID } from 'node:crypto';

export interface EventEnvelope<T = unknown> {
  eventId: string;
  eventType: string;
  correlationId: string;
  occurredAt: string;
  payload: T;
}

interface CreateEnvelopeInput<T> {
  eventType: string;
  correlationId: string;
  payload: T;
  eventId?: string;
  occurredAt?: Date;
}

export function buildEventEnvelope<T>({
  eventType,
  correlationId,
  payload,
  eventId = randomUUID(),
  occurredAt = new Date(),
}: CreateEnvelopeInput<T>): EventEnvelope<T> {
  return { eventId, eventType, correlationId, occurredAt: occurredAt.toISOString(), payload };
}
