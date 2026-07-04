/**
 * Shipment status values — single source of truth. Lives in src/types so the DB layer and the
 * app layer both depend on it without coupling to each other. `SHIPMENT_STATUSES` drives the
 * Drizzle column default, the `ShipmentStatus` union, and the named `ShipmentStatuses` constants.
 * The status-machine logic (NEXT map, `nextShipmentStatus`, `canTransition`, `assertTransition`)
 * lives in src/modules/shipping/shipment-status.ts and imports from here. Reference statuses as
 * `ShipmentStatuses.InTransit`, never a bare string.
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
