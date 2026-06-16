import type { Channel, ConfirmChannel } from 'amqplib';
import { ORDER_CREATED_EVENT, ORDER_EVENTS_EXCHANGE } from '@infra/mq/outbox-event-types.js';

export const ORDER_EMAIL_QUEUE = 'order.created.email';
export const ORDER_EVENTS_DLX = 'order.events.dlx';
export const ORDER_EMAIL_DLQ = 'order.created.email.dlq';
const DEAD_ROUTING_KEY = 'order.created.dead';

/**
 * Declares the exchange/queue/binding topology (idempotent — safe to call at every
 * boot). The main queue dead-letters to a DLX → DLQ so a message that fails
 * repeatedly lands in the DLQ instead of looping forever.
 */
export async function assertTopology(ch: Channel | ConfirmChannel): Promise<void> {
  await ch.assertExchange(ORDER_EVENTS_EXCHANGE, 'topic', { durable: true });
  await ch.assertExchange(ORDER_EVENTS_DLX, 'topic', { durable: true });

  await ch.assertQueue(ORDER_EMAIL_QUEUE, {
    durable: true,
    deadLetterExchange: ORDER_EVENTS_DLX,
    deadLetterRoutingKey: DEAD_ROUTING_KEY,
  });
  await ch.bindQueue(ORDER_EMAIL_QUEUE, ORDER_EVENTS_EXCHANGE, ORDER_CREATED_EVENT);

  await ch.assertQueue(ORDER_EMAIL_DLQ, { durable: true });
  await ch.bindQueue(ORDER_EMAIL_DLQ, ORDER_EVENTS_DLX, DEAD_ROUTING_KEY);
}
