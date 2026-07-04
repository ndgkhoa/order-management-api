import { describe, it, expect } from 'vitest';
import { makeNotificationsService } from '@modules/notifications/notifications-service.js';

const notifications = makeNotificationsService();
import {
  ORDER_CREATED_EVENT,
  ORDER_PAID_EVENT,
  ORDER_CANCELLED_EVENT,
  SHIPMENT_IN_TRANSIT_EVENT,
  SHIPMENT_DELIVERED_EVENT,
  ORDER_REFUNDED_EVENT,
} from '@infra/mq/outbox-event-types.js';

describe('notification routing', () => {
  it('routes user-facing saga events to email', () => {
    for (const evt of [
      ORDER_PAID_EVENT,
      ORDER_CANCELLED_EVENT,
      SHIPMENT_IN_TRANSIT_EVENT,
      ORDER_REFUNDED_EVENT,
    ]) {
      const route = notifications.route(evt);
      expect(route?.channels).toContain('email');
    }
  });

  it('routes shipment.delivered to email AND sms (multi-channel)', () => {
    const route = notifications.route(SHIPMENT_DELIVERED_EVENT);
    expect(route?.channels).toEqual(expect.arrayContaining(['email', 'sms']));
  });

  it('renders a subject and body referencing the order', () => {
    const route = notifications.route(ORDER_PAID_EVENT);
    const msg = route!.render({ orderId: 'order-123' });
    expect(msg.subject).toContain('order-123');
    expect(msg.body.length).toBeGreaterThan(0);
  });

  it('includes the reason in a cancellation message when present', () => {
    const msg = notifications.route(ORDER_CANCELLED_EVENT)!.render({
      orderId: 'o1',
      reason: 'out_of_stock',
    });
    expect(msg.body).toContain('out_of_stock');
  });

  it('routes order.created to email and lists the ordered items + total', () => {
    const route = notifications.route(ORDER_CREATED_EVENT);
    expect(route?.channels).toEqual(['email']);
    const msg = route!.render({
      orderId: 'order-7',
      items: [
        { sku: 'SKU-A', quantity: 2 },
        { sku: 'SKU-B', quantity: 1 },
      ],
      totalCents: 4500,
    });
    expect(msg.subject).toContain('order-7');
    expect(msg.body).toContain('2x SKU-A');
    expect(msg.body).toContain('1x SKU-B');
    expect(msg.body).toContain('45.00');
  });

  it('returns undefined for an unrouted event (no-op)', () => {
    expect(notifications.route('inventory.reserved')).toBeUndefined();
    expect(notifications.route('shipment.ready_for_pickup')).toBeUndefined();
  });
});
