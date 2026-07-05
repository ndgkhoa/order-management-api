import { randomUUID } from 'node:crypto';
import type { ConsumeMessage } from 'amqplib';
import type { FastifyBaseLogger } from 'fastify';
import type { DB } from '@infra/db/client';
import type { PaymentCreatedPayload } from '@infra/mq/outbox-event-types';
import type { HandlerResult } from '@infra/mq/consumer';
import { parseEnvelope, claimOnce } from '@infra/mq/idempotent-consumer';
import { MOCK_PROVIDER_CONSUMER } from '@/constants/index';
import { signWebhook } from '@infra/http/webhook-signature';
import type { SettleOutcome } from '@modules/payments/payments-schema';

export interface FakeProviderConfig {
  webhookUrl: string;
  secret: string;
  delayMs: number;
}

export async function deliverPaymentResult(
  config: Pick<FakeProviderConfig, 'webhookUrl' | 'secret'>,
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
  config: FakeProviderConfig;
  log: FastifyBaseLogger;
}

export async function fakeProviderOnPaymentCreated(
  msg: ConsumeMessage,
  { db, config, log }: HandlerDeps,
): Promise<HandlerResult> {
  const envelope = parseEnvelope<PaymentCreatedPayload>(msg, log);
  if (!envelope) return 'ack';
  const eventId = envelope.eventId;
  const { paymentId } = envelope.payload;

  try {
    let duplicate = false;
    await db.transaction(async (tx) => {
      if (!(await claimOnce(tx, MOCK_PROVIDER_CONSUMER, eventId))) duplicate = true;
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
