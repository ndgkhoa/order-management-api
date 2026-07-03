import { describe, it, expect } from 'vitest';
import {
  canTransition,
  assertTransition,
  nextShipmentStatus,
} from '@modules/shipping/shipment-status.js';

describe('shipment status machine', () => {
  it('allows only adjacent forward transitions', () => {
    expect(canTransition('pending', 'ready_for_pickup')).toBe(true);
    expect(canTransition('ready_for_pickup', 'in_transit')).toBe(true);
    expect(canTransition('in_transit', 'delivered')).toBe(true);
  });

  it('rejects skipping steps and going backward', () => {
    expect(canTransition('pending', 'in_transit')).toBe(false);
    expect(canTransition('pending', 'delivered')).toBe(false);
    expect(canTransition('in_transit', 'ready_for_pickup')).toBe(false);
    expect(canTransition('delivered', 'in_transit')).toBe(false);
  });

  it('nextShipmentStatus walks the linear flow and stops at delivered', () => {
    expect(nextShipmentStatus('pending')).toBe('ready_for_pickup');
    expect(nextShipmentStatus('ready_for_pickup')).toBe('in_transit');
    expect(nextShipmentStatus('in_transit')).toBe('delivered');
    expect(nextShipmentStatus('delivered')).toBeNull();
  });

  it('assertTransition throws on an illegal transition', () => {
    expect(() => assertTransition('pending', 'delivered')).toThrow();
    expect(() => assertTransition('pending', 'ready_for_pickup')).not.toThrow();
  });
});
