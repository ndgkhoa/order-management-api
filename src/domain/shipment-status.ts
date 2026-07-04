/**
 * Shipment status — the single home for both the vocabulary AND the legal transitions.
 * Values (`SHIPMENT_STATUSES`, `ShipmentStatus`, `ShipmentStatuses`) drive the Drizzle column
 * default and every typed reference; the machine (`NEXT` / `nextShipmentStatus` / `canTransition` /
 * `assertTransition`) guards moves. Linear and forward-only: pending → ready_for_pickup →
 * in_transit → delivered (terminal). Reference statuses as `ShipmentStatuses.InTransit`.
 */
export const SHIPMENT_STATUSES = [
  'pending',
  'ready_for_pickup',
  'in_transit',
  'delivered',
] as const;

export type ShipmentStatus = (typeof SHIPMENT_STATUSES)[number];

/** A status reachable by advancing (never the initial `pending`). */
export type AdvancedShipmentStatus = Exclude<ShipmentStatus, 'pending'>;

export const ShipmentStatuses = {
  Pending: 'pending',
  ReadyForPickup: 'ready_for_pickup',
  InTransit: 'in_transit',
  Delivered: 'delivered',
} as const satisfies Record<string, ShipmentStatus>;

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
