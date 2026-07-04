import type { ConsumeMessage } from 'amqplib';
import type { AppInstance } from '@/app.js';
import { signWebhook } from '@infra/http/webhook-signature.js';

const WEBHOOK_SECRET = process.env.WEBHOOK_HMAC_SECRET!;

/**
 * Builds a ConsumeMessage wrapping an EventEnvelope so tests can drive a saga handler directly
 * (without RabbitMQ). `correlationId` defaults to the payload's orderId, matching the relay.
 */
export function envelopeMsg(eventType: string, payload: unknown): ConsumeMessage {
  const envelope = {
    eventId: crypto.randomUUID(),
    eventType,
    correlationId: (payload as { orderId: string }).orderId,
    occurredAt: new Date().toISOString(),
    payload,
  };
  return {
    content: Buffer.from(JSON.stringify(envelope)),
    properties: { messageId: envelope.eventId },
    fields: {},
  } as unknown as ConsumeMessage;
}

/** Posts an HMAC-signed payment webhook, signing the exact raw bytes like the mock provider does. */
export function postSignedWebhook(app: AppInstance, body: Record<string, unknown>) {
  const raw = JSON.stringify(body);
  return app.inject({
    method: 'POST',
    url: '/webhooks/payment',
    headers: {
      'content-type': 'application/json',
      'x-signature': signWebhook(WEBHOOK_SECRET, raw),
    },
    payload: raw,
  });
}
