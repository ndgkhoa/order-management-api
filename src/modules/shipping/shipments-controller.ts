import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ShipmentsService } from '@modules/shipping/shipments-service.js';

interface ControllerDeps {
  service: ShipmentsService;
}

/**
 * Admin manual shipment control. Advances one step through the SAME status machine + CAS as
 * the fake worker (it is a second writer), which also makes this the manual recovery path for
 * a shipment stranded by a lost in-process timer. 404 if unknown, 409 if already delivered.
 */
export function makeShipmentsController({ service }: ControllerDeps) {
  return {
    advance: async (req: FastifyRequest, reply: FastifyReply) => {
      const { id } = req.params as { id: string };
      const shipment = await service.advance(id);
      return reply.code(200).send(shipment);
    },
  };
}
