import type { FastifyInstance } from 'fastify';
import type { ShipmentsRepository } from '@modules/shipping/shipments-repository';
import { toShipmentPublic } from '@modules/shipping/shipments-schema';

interface ShipmentsServiceDeps {
  shipmentsRepo: ShipmentsRepository;
  httpErrors: FastifyInstance['httpErrors'];
}

export function makeShipmentsService({ shipmentsRepo, httpErrors }: ShipmentsServiceDeps) {
  return {
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
