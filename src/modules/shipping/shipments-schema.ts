import { Type, type Static } from '@sinclair/typebox';
import type { InferSelectModel } from 'drizzle-orm';
import type { shipments } from '@infra/db/schema.js';

/** Shipment view returned by the admin manual-advance endpoint. */
export const ShipmentPublic = Type.Object({
  id: Type.String(),
  orderId: Type.String(),
  status: Type.String(),
  carrier: Type.String(),
  trackingNo: Type.Union([Type.String(), Type.Null()]),
  createdAt: Type.String(),
  updatedAt: Type.String(),
});
export type ShipmentPublic = Static<typeof ShipmentPublic>;

export function toShipmentPublic(s: InferSelectModel<typeof shipments>): ShipmentPublic {
  return {
    id: s.id,
    orderId: s.orderId,
    status: s.status,
    carrier: s.carrier,
    trackingNo: s.trackingNo,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

/** Route param: a single UUID `id` (`/resource/:id`). */
export const IdParams = Type.Object({ id: Type.String({ format: 'uuid' }) });
