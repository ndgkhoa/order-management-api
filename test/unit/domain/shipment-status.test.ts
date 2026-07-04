import { describe, it, expect } from 'vitest';
import { canTransition, assertTransition, nextStatus } from '@/utils/state-machine.js';
import { SHIPMENT_TRANSITIONS } from '@/types/shipment-status.js';

describe('shipment status machine', () => {
  it('allows only adjacent forward transitions', () => {
    expect(canTransition(SHIPMENT_TRANSITIONS, 'pending', 'ready_for_pickup')).toBe(true);
    expect(canTransition(SHIPMENT_TRANSITIONS, 'ready_for_pickup', 'in_transit')).toBe(true);
    expect(canTransition(SHIPMENT_TRANSITIONS, 'in_transit', 'delivered')).toBe(true);
  });

  it('rejects skipping steps and going backward', () => {
    expect(canTransition(SHIPMENT_TRANSITIONS, 'pending', 'in_transit')).toBe(false);
    expect(canTransition(SHIPMENT_TRANSITIONS, 'pending', 'delivered')).toBe(false);
    expect(canTransition(SHIPMENT_TRANSITIONS, 'in_transit', 'ready_for_pickup')).toBe(false);
    expect(canTransition(SHIPMENT_TRANSITIONS, 'delivered', 'in_transit')).toBe(false);
  });

  it('nextStatus walks the linear flow and stops at delivered', () => {
    expect(nextStatus(SHIPMENT_TRANSITIONS, 'pending')).toBe('ready_for_pickup');
    expect(nextStatus(SHIPMENT_TRANSITIONS, 'ready_for_pickup')).toBe('in_transit');
    expect(nextStatus(SHIPMENT_TRANSITIONS, 'in_transit')).toBe('delivered');
    expect(nextStatus(SHIPMENT_TRANSITIONS, 'delivered')).toBeNull();
  });

  it('assertTransition throws on an illegal transition', () => {
    expect(() => assertTransition(SHIPMENT_TRANSITIONS, 'pending', 'delivered')).toThrow();
    expect(() =>
      assertTransition(SHIPMENT_TRANSITIONS, 'pending', 'ready_for_pickup'),
    ).not.toThrow();
  });
});
