import type { ConsumeMessage } from 'amqplib';
import type { FastifyBaseLogger } from 'fastify';
import { processedMessages } from '@infra/db/schema.js';
import type { Tx } from '@infra/db/client.js';
import type { EventEnvelope } from '@infra/mq/event-envelope.js';

export function parseEnvelope<P>(
  msg: ConsumeMessage,
  log: FastifyBaseLogger,
): EventEnvelope<P> | null {
  let envelope: EventEnvelope<P>;
  try {
    envelope = JSON.parse(msg.content.toString()) as EventEnvelope<P>;
  } catch (err) {
    log.error({ err }, 'malformed message body; dropping to avoid poison loop');
    return null;
  }
  if (!envelope.eventId) {
    log.error('message missing eventId; dropping to avoid poison loop');
    return null;
  }
  return envelope;
}

export async function claimOnce(tx: Tx, consumerName: string, eventId: string): Promise<boolean> {
  const inserted = await tx
    .insert(processedMessages)
    .values({ consumerName, eventId })
    .onConflictDoNothing()
    .returning();
  return inserted.length > 0;
}
