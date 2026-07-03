import { randomUUID } from 'node:crypto';
import type { ConsumeMessage } from 'amqplib';
import type { FastifyBaseLogger } from 'fastify';
import type { DB } from '@infra/db/client.js';
import { processedMessages } from '@infra/db/schema.js';
import type { EventEnvelope } from '@infra/mq/event-envelope.js';
import type { PaymentCreatedPayload } from '@infra/mq/outbox-event-types.js';
import type { HandlerResult } from '@infra/mq/consumer.js';
import { signWebhook } from '@modules/payments/webhook-signature.js';
import type { SettleOutcome } from '@modules/payments/payments-service.js';

/** Distinct dedup dimension so the mock provider processes each payment.created once. */
const CONSUMER_NAME = 'mock-provider';

export interface MockProviderConfig {
  webhookUrl: string;
  secret: string;
  delayMs: number;
}

/**
 * Simulates a payment provider by posting a fresh HMAC-signed webhook back to our own API.
 * A new `providerEventId` per delivery keeps deliveries distinct; the API dedups on it.
 * Shared by the auto-timer (default SUCCEEDED) and the admin force-endpoints.
 */
export async function deliverPaymentResult(
  config: Pick<MockProviderConfig, 'webhookUrl' | 'secret'>,
  paymentId: string,
  outcome: SettleOutcome,
  log: FastifyBaseLogger,
): Promise<void> {
  const body = JSON.stringify({
    providerEventId: randomUUID(),
    paymentId,
    outcome,
    timestamp: Date.now(),
  });
  try {
    const res = await fetch(config.webhookUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-signature': signWebhook(config.secret, body),
      },
      body,
    });
    if (!res.ok) log.warn({ paymentId, status: res.status }, 'mock webhook delivery non-2xx');
  } catch (err) {
    log.error({ err, paymentId }, 'mock webhook delivery failed');
  }
}

interface HandlerDeps {
  db: DB;
  config: MockProviderConfig;
  log: FastifyBaseLogger;
}

/**
 * `payment.created` consumer: after `delayMs`, delivers a default SUCCEEDED webhook. The timer
 * is in-process (lost on restart — acceptable for a mock; a real provider would use a durable
 * delayed message). Admin force-endpoints can drive an explicit outcome out of band.
 */
export async function mockProviderOnPaymentCreated(
  msg: ConsumeMessage,
  { db, config, log }: HandlerDeps,
): Promise<HandlerResult> {
  let envelope: EventEnvelope<PaymentCreatedPayload>;
  try {
    envelope = JSON.parse(msg.content.toString()) as EventEnvelope<PaymentCreatedPayload>;
  } catch (err) {
    log.error({ err }, 'malformed payment.created; dropping');
    return 'ack';
  }
  const eventId = envelope.eventId;
  if (!eventId) return 'ack';
  const { paymentId } = envelope.payload;

  try {
    let duplicate = false;
    await db.transaction(async (tx) => {
      const inserted = await tx
        .insert(processedMessages)
        .values({ consumerName: CONSUMER_NAME, eventId })
        .onConflictDoNothing()
        .returning();
      if (inserted.length === 0) duplicate = true;
    });
    if (duplicate) return 'ack';

    setTimeout(
      () => void deliverPaymentResult(config, paymentId, 'SUCCEEDED', log),
      config.delayMs,
    );
    return 'ack';
  } catch (err) {
    log.error({ err, eventId }, 'mock provider handler failed');
    return 'retry';
  }
}
