import type { Channel, ConfirmChannel } from 'amqplib';
import {
  ORDER_CREATED_EVENT,
  ORDER_EVENTS_EXCHANGE,
  INVENTORY_RESERVED_EVENT,
  PAYMENT_CREATED_EVENT,
  PAYMENT_SUCCEEDED_EVENT,
  PAYMENT_FAILED_EVENT,
  ORDER_PAID_EVENT,
  ORDER_CANCELLED_EVENT,
  ORDER_REFUNDED_EVENT,
  SHIPMENT_IN_TRANSIT_EVENT,
  SHIPMENT_DELIVERED_EVENT,
} from '@infra/mq/outbox-event-types.js';

export const ORDER_INVENTORY_QUEUE = 'order.created.inventory';
export const PAYMENT_CREATE_QUEUE = 'inventory.reserved.payment';
export const MOCK_PROVIDER_QUEUE = 'payment.created.mock';
export const PAYMENT_COMPLETE_QUEUE = 'payment.succeeded.order';
export const PAYMENT_COMPENSATE_QUEUE = 'payment.failed.order';
export const SHIPPING_QUEUE = 'order.paid.shipping';
export const NOTIFICATION_QUEUE = 'notifications';
export const ORDER_EVENTS_DLX = 'order.events.dlx';
export const ORDER_INVENTORY_DLQ = 'order.created.inventory.dlq';
// Per-consumer dead-letter keys — each consumer's failures route to its own DLQ.
// NOTE: a RabbitMQ queue is immutable. An environment that already declared a queue with a
// different `x-dead-letter-routing-key` must delete that queue once so it re-declares with this
// key (else boot fails 406 PRECONDITION_FAILED).
const INVENTORY_DEAD_KEY = 'order.created.inventory.dead';
const PAYMENT_CREATE_DEAD_KEY = 'inventory.reserved.payment.dead';
const MOCK_PROVIDER_DEAD_KEY = 'payment.created.mock.dead';
const PAYMENT_COMPLETE_DEAD_KEY = 'payment.succeeded.order.dead';
const PAYMENT_COMPENSATE_DEAD_KEY = 'payment.failed.order.dead';
const SHIPPING_DEAD_KEY = 'order.paid.shipping.dead';
const NOTIFICATION_DEAD_KEY = 'notifications.dead';

/** Events that trigger a user-facing notification (bound to the single notifications queue). */
const NOTIFICATION_KEYS = [
  ORDER_CREATED_EVENT,
  ORDER_PAID_EVENT,
  ORDER_CANCELLED_EVENT,
  ORDER_REFUNDED_EVENT,
  SHIPMENT_IN_TRANSIT_EVENT,
  SHIPMENT_DELIVERED_EVENT,
];

/** Declares one main queue + its DLQ, both bound to the topic exchange / DLX. */
async function assertConsumerQueue(
  ch: Channel | ConfirmChannel,
  queue: string,
  dlq: string,
  deadKey: string,
  bindingKey: string,
): Promise<void> {
  await ch.assertQueue(queue, {
    durable: true,
    deadLetterExchange: ORDER_EVENTS_DLX,
    deadLetterRoutingKey: deadKey,
  });
  await ch.bindQueue(queue, ORDER_EVENTS_EXCHANGE, bindingKey);
  await ch.assertQueue(dlq, { durable: true });
  await ch.bindQueue(dlq, ORDER_EVENTS_DLX, deadKey);
}

/**
 * Declares the exchange/queue/binding topology (idempotent — safe to call at every boot).
 * Each consumer gets its OWN queue, so independent subscribers (e.g. inventory and notifications
 * both on `order.created`) fan out rather than compete. Each main queue dead-letters to a DLX →
 * per-consumer DLQ so a repeatedly failing message parks there.
 */
export async function assertTopology(ch: Channel | ConfirmChannel): Promise<void> {
  await ch.assertExchange(ORDER_EVENTS_EXCHANGE, 'topic', { durable: true });
  await ch.assertExchange(ORDER_EVENTS_DLX, 'topic', { durable: true });

  await assertConsumerQueue(
    ch,
    ORDER_INVENTORY_QUEUE,
    ORDER_INVENTORY_DLQ,
    INVENTORY_DEAD_KEY,
    ORDER_CREATED_EVENT,
  );

  // Payment saga: reserve → create payment → mock provider → succeeded/failed → order.
  await assertConsumerQueue(
    ch,
    PAYMENT_CREATE_QUEUE,
    `${PAYMENT_CREATE_QUEUE}.dlq`,
    PAYMENT_CREATE_DEAD_KEY,
    INVENTORY_RESERVED_EVENT,
  );
  await assertConsumerQueue(
    ch,
    MOCK_PROVIDER_QUEUE,
    `${MOCK_PROVIDER_QUEUE}.dlq`,
    MOCK_PROVIDER_DEAD_KEY,
    PAYMENT_CREATED_EVENT,
  );
  await assertConsumerQueue(
    ch,
    PAYMENT_COMPLETE_QUEUE,
    `${PAYMENT_COMPLETE_QUEUE}.dlq`,
    PAYMENT_COMPLETE_DEAD_KEY,
    PAYMENT_SUCCEEDED_EVENT,
  );
  await assertConsumerQueue(
    ch,
    PAYMENT_COMPENSATE_QUEUE,
    `${PAYMENT_COMPENSATE_QUEUE}.dlq`,
    PAYMENT_COMPENSATE_DEAD_KEY,
    PAYMENT_FAILED_EVENT,
  );

  // Shipping: order.paid → create shipment and drive its lifecycle.
  await assertConsumerQueue(
    ch,
    SHIPPING_QUEUE,
    `${SHIPPING_QUEUE}.dlq`,
    SHIPPING_DEAD_KEY,
    ORDER_PAID_EVENT,
  );

  // Notifications: ONE queue subscribing to several user-facing events (multiple bindings).
  await assertConsumerQueue(
    ch,
    NOTIFICATION_QUEUE,
    `${NOTIFICATION_QUEUE}.dlq`,
    NOTIFICATION_DEAD_KEY,
    NOTIFICATION_KEYS[0]!,
  );
  for (const key of NOTIFICATION_KEYS.slice(1)) {
    await ch.bindQueue(NOTIFICATION_QUEUE, ORDER_EVENTS_EXCHANGE, key);
  }
}
