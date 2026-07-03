import { eq } from 'drizzle-orm';
import type { DB } from '@infra/db/client.js';
import { shipments } from '@infra/db/schema.js';

/** Data access for shipments. Advancing status lives in `advance-shipment.ts` (transactional). */
export function makeShipmentsRepository(db: DB) {
  return {
    findById: (id: string) => db.query.shipments.findFirst({ where: eq(shipments.id, id) }),
  };
}

export type ShipmentsRepository = ReturnType<typeof makeShipmentsRepository>;
