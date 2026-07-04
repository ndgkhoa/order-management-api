import { describe, it, expect } from 'vitest';
import { routeNotification } from '@modules/notifications/notification-templates.js';
import {
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
      const route = routeNotification(evt);
      expect(route?.channels).toContain('email');
    }
  });

  it('routes shipment.delivered to email AND sms (multi-channel)', () => {
    const route = routeNotification(SHIPMENT_DELIVERED_EVENT);
    expect(route?.channels).toEqual(expect.arrayContaining(['email', 'sms']));
  });

  it('renders a subject and body referencing the order', () => {
    const route = routeNotification(ORDER_PAID_EVENT);
    const msg = route!.render({ orderId: 'order-123' });
    expect(msg.subject).toContain('order-123');
    expect(msg.body.length).toBeGreaterThan(0);
  });

  it('includes the reason in a cancellation message when present', () => {
    const msg = routeNotification(ORDER_CANCELLED_EVENT)!.render({
      orderId: 'o1',
      reason: 'out_of_stock',
    });
    expect(msg.body).toContain('out_of_stock');
  });

  it('returns undefined for an unrouted event (no-op)', () => {
    expect(routeNotification('order.created')).toBeUndefined();
    expect(routeNotification('shipment.ready_for_pickup')).toBeUndefined();
  });
});
