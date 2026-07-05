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
} from '@infra/mq/outbox-event-types';

export const ORDER_INVENTORY_QUEUE = 'order.created.inventory';
export const PAYMENT_CREATE_QUEUE = 'inventory.reserved.payment';
export const MOCK_PROVIDER_QUEUE = 'payment.created.mock';
export const PAYMENT_COMPLETE_QUEUE = 'payment.succeeded.order';
export const PAYMENT_COMPENSATE_QUEUE = 'payment.failed.order';
export const SHIPPING_QUEUE = 'order.paid.shipping';
export const NOTIFICATION_QUEUE = 'notifications';
export const ORDER_EVENTS_DLX = 'order.events.dlx';
export const ORDER_INVENTORY_DLQ = 'order.created.inventory.dlq';
// A RabbitMQ queue is immutable: changing x-dead-letter-routing-key requires deleting the queue once, else boot fails 406 PRECONDITION_FAILED.
const INVENTORY_DEAD_KEY = 'order.created.inventory.dead';
const PAYMENT_CREATE_DEAD_KEY = 'inventory.reserved.payment.dead';
const MOCK_PROVIDER_DEAD_KEY = 'payment.created.mock.dead';
const PAYMENT_COMPLETE_DEAD_KEY = 'payment.succeeded.order.dead';
const PAYMENT_COMPENSATE_DEAD_KEY = 'payment.failed.order.dead';
const SHIPPING_DEAD_KEY = 'order.paid.shipping.dead';
const NOTIFICATION_DEAD_KEY = 'notifications.dead';

const NOTIFICATION_KEYS = [
  ORDER_CREATED_EVENT,
  ORDER_PAID_EVENT,
  ORDER_CANCELLED_EVENT,
  ORDER_REFUNDED_EVENT,
  SHIPMENT_IN_TRANSIT_EVENT,
  SHIPMENT_DELIVERED_EVENT,
];

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

  await assertConsumerQueue(
    ch,
    SHIPPING_QUEUE,
    `${SHIPPING_QUEUE}.dlq`,
    SHIPPING_DEAD_KEY,
    ORDER_PAID_EVENT,
  );

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
