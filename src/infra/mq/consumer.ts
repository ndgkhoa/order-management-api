import type { Channel, ConsumeMessage } from 'amqplib';
import type { FastifyBaseLogger } from 'fastify';
import { ORDER_EVENTS_EXCHANGE } from '@infra/mq/outbox-event-types.js';

/** What a message handler asks the consumer to do: acknowledge, or retry (nack + backoff). */
export type HandlerResult = 'ack' | 'retry';

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

interface ConsumerOptions {
  log: FastifyBaseLogger;
  maxAttempts?: number;
  prefetch?: number;
}

/**
 * Generic consumer: prefetch-bounded, with in-process retry + exponential backoff,
 * then dead-letter (nack no-requeue → DLX → DLQ) after maxAttempts. Retry count is
 * carried in the `x-attempts` header on re-publish.
 * (Production alternative: a dedicated TTL retry queue that dead-letters back to the
 * main queue, avoiding an in-process delay that holds the channel.)
 */
export async function startConsumer(
  ch: Channel,
  queue: string,
  handler: (msg: ConsumeMessage) => Promise<HandlerResult>,
  { log, maxAttempts = 3, prefetch = 10 }: ConsumerOptions,
): Promise<void> {
  await ch.prefetch(prefetch);

  async function processMessage(msg: ConsumeMessage): Promise<void> {
    const result = await handler(msg);
    if (result === 'ack') {
      ch.ack(msg);
      return;
    }

    const headers = (msg.properties.headers ?? {}) as Record<string, unknown>;
    const prev = typeof headers['x-attempts'] === 'number' ? headers['x-attempts'] : 0;
    const attempts = prev + 1;

    if (attempts >= maxAttempts) {
      log.warn({ messageId: msg.properties.messageId, attempts }, 'max attempts reached → DLQ');
      ch.nack(msg, false, false); // no requeue → dead-letters to DLX/DLQ
      return;
    }

    await delay(2 ** attempts * 200); // exponential backoff
    ch.publish(ORDER_EVENTS_EXCHANGE, msg.fields.routingKey, msg.content, {
      ...msg.properties,
      headers: { ...headers, 'x-attempts': attempts },
    });
    ch.ack(msg);
  }

  await ch.consume(
    queue,
    (msg) => {
      if (msg) void processMessage(msg);
    },
    { noAck: false },
  );
}
