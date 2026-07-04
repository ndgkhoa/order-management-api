import type { FastifyInstance } from 'fastify';
import type { ShipmentsRepository } from '@modules/shipping/shipments-repository.js';
import { toShipmentPublic } from '@modules/shipping/shipments-schema.js';

interface ShipmentsServiceDeps {
  shipmentsRepo: ShipmentsRepository;
  httpErrors: FastifyInstance['httpErrors'];
}

/**
 * Shipments business logic. All DB/transaction work lives in the repository. This layer
 * maps repository outcomes to HTTP errors and serialises the response shape.
 */
export function makeShipmentsService({ shipmentsRepo, httpErrors }: ShipmentsServiceDeps) {
  return {
    /** Advance a shipment one step. 404 if unknown, 409 if already delivered. */
    async advance(id: string) {
      const existing = await shipmentsRepo.findById(id);
      if (!existing) throw httpErrors.notFound('shipment not found');

      const next = await shipmentsRepo.advance(id);
      if (!next) throw httpErrors.conflict('shipment already delivered');

      const updated = await shipmentsRepo.findById(id);
      return toShipmentPublic(updated!);
    },
  };
}

export type ShipmentsService = ReturnType<typeof makeShipmentsService>;
