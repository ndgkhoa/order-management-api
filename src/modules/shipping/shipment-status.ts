/**
 * Canonical shipment status machine — the single source of truth for legal transitions.
 * Linear and forward-only: pending → ready_for_pickup → in_transit → delivered (terminal).
 * The fake worker and the admin manual endpoint both advance strictly one step via CAS.
 * Status values and types live in `@/types/shipment-status.ts`; import them from there.
 */
import { type ShipmentStatus, type AdvancedShipmentStatus } from '@/types/shipment-status.js';

const NEXT: Record<ShipmentStatus, AdvancedShipmentStatus | null> = {
  pending: 'ready_for_pickup',
  ready_for_pickup: 'in_transit',
  in_transit: 'delivered',
  delivered: null, // terminal
};

/** The next status in the linear flow, or null if already delivered. */
export function nextShipmentStatus(from: ShipmentStatus): AdvancedShipmentStatus | null {
  return NEXT[from];
}

export function canTransition(from: ShipmentStatus, to: ShipmentStatus): boolean {
  return NEXT[from] === to;
}

/** Throws on an illegal (non-adjacent) transition. Callers use compare-and-set on the row. */
export function assertTransition(from: ShipmentStatus, to: ShipmentStatus): void {
  if (!canTransition(from, to)) {
    throw new Error(`illegal shipment status transition: ${from} → ${to}`);
  }
}
