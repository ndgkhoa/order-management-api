import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Permissions } from '@/types/permission';
import { makeShipmentsRepository } from '@modules/shipping/shipments-repository';
import { makeShipmentsService } from '@modules/shipping/shipments-service';
import { makeShipmentsController } from '@modules/shipping/shipments-controller';
import { ShipmentPublic, IdParams } from '@modules/shipping/shipments-schema';
import { errorResponses } from '@infra/http/error-responses';

export const shipmentsRoutes: FastifyPluginAsyncTypebox = (app) => {
  const shipmentsRepo = makeShipmentsRepository(app.db);
  const service = makeShipmentsService({ shipmentsRepo, httpErrors: app.httpErrors });
  const controller = makeShipmentsController(service);

  app.patch(
    '/:id/status',
    {
      preHandler: [app.authenticate, app.requirePermission(Permissions.Shipment.Update)],
      schema: {
        tags: ['shipments'],
        params: IdParams,
        response: { 200: ShipmentPublic, ...errorResponses(401, 403, 404, 409) },
      },
    },
    controller.advance,
  );

  return Promise.resolve();
};
