/**
 * Shipment status vocabulary + legal-transition map. Values (`SHIPMENT_STATUSES`, `ShipmentStatus`,
 * `ShipmentStatuses`) drive the Drizzle column default and every typed reference;
 * `SHIPMENT_TRANSITIONS` is the (linear, forward-only) state machine evaluated by the generic
 * guards in `@/utils/state-machine`: pending → ready_for_pickup → in_transit → delivered
 * (terminal). Reference statuses as `ShipmentStatuses.InTransit`.
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

export const SHIPMENT_TRANSITIONS: Record<ShipmentStatus, readonly ShipmentStatus[]> = {
  pending: ['ready_for_pickup'],
  ready_for_pickup: ['in_transit'],
  in_transit: ['delivered'],
  delivered: [], // terminal
};
