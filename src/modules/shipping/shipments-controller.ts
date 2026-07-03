import type { FastifyInstance, FastifyReply, FastifyRequest, FastifyBaseLogger } from 'fastify';
import type { DB } from '@infra/db/client.js';
import { makeShipmentsRepository } from '@modules/shipping/shipments-repository.js';
import { advanceShipment } from '@modules/shipping/advance-shipment.js';
import { toShipmentPublic } from '@modules/shipping/shipments-schema.js';

interface ControllerDeps {
  db: DB;
  httpErrors: FastifyInstance['httpErrors'];
  log: FastifyBaseLogger;
}

/**
 * Admin manual shipment control. Advances one step through the SAME status machine + CAS as
 * the fake worker (it is a second writer), which also makes this the manual recovery path for
 * a shipment stranded by a lost in-process timer. 404 if unknown, 409 if already delivered.
 */
export function makeShipmentsController({ db, httpErrors, log }: ControllerDeps) {
  const repo = makeShipmentsRepository(db);

  return {
    advance: async (req: FastifyRequest, reply: FastifyReply) => {
      const { id } = req.params as { id: string };
      const existing = await repo.findById(id);
      if (!existing) throw httpErrors.notFound('shipment not found');

      const next = await advanceShipment(db, id, log);
      if (!next) throw httpErrors.conflict('shipment already delivered');

      const updated = await repo.findById(id);
      return reply.code(200).send(toShipmentPublic(updated!));
    },
  };
}
