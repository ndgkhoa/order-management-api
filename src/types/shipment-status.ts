export const SHIPMENT_STATUSES = [
  'pending',
  'ready_for_pickup',
  'in_transit',
  'delivered',
] as const;

export type ShipmentStatus = (typeof SHIPMENT_STATUSES)[number];

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
  delivered: [],
};
