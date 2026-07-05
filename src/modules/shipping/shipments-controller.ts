import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ShipmentsService } from '@modules/shipping/shipments-service';

export function makeShipmentsController(service: ShipmentsService) {
  return {
    advance: async (req: FastifyRequest, reply: FastifyReply) => {
      const { id } = req.params as { id: string };
      const shipment = await service.advance(id);
      return reply.code(200).send(shipment);
    },
  };
}
