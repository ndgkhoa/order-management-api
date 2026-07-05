import type { ConsumeMessage } from 'amqplib';
import { and, desc, eq } from 'drizzle-orm';
import type { AppInstance } from '@/app';
import { db } from '@infra/db/client';
import { outboxMessages } from '@infra/db/schema';
import { signWebhook } from '@infra/http/webhook-signature';

const WEBHOOK_SECRET = process.env.WEBHOOK_HMAC_SECRET!;

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

export async function outboxMsg(orderId: string, eventType: string): Promise<ConsumeMessage> {
  const [row] = await db
    .select()
    .from(outboxMessages)
    .where(and(eq(outboxMessages.aggregateId, orderId), eq(outboxMessages.eventType, eventType)))
    .orderBy(desc(outboxMessages.createdAt))
    .limit(1);
  const envelope = {
    eventId: row!.eventId,
    eventType: row!.eventType,
    correlationId: row!.correlationId ?? orderId,
    occurredAt: row!.createdAt.toISOString(),
    payload: row!.payload,
  };
  return {
    content: Buffer.from(JSON.stringify(envelope)),
    properties: { messageId: row!.eventId },
    fields: {},
  } as unknown as ConsumeMessage;
}

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
