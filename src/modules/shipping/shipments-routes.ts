import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Permissions } from '@/types/permission.js';
import { makeShipmentsRepository } from '@modules/shipping/shipments-repository.js';
import { makeShipmentsService } from '@modules/shipping/shipments-service.js';
import { makeShipmentsController } from '@modules/shipping/shipments-controller.js';
import { ShipmentPublic, IdParams } from '@modules/shipping/shipments-schema.js';
import { errorResponses } from '@infra/http/error-responses.js';

/** /shipments admin routes. Manual one-step advance (also the lost-timer recovery path). */
export const shipmentsRoutes: FastifyPluginAsyncTypebox = (app) => {
  const shipmentsRepo = makeShipmentsRepository(app.db);
  const service = makeShipmentsService({ shipmentsRepo, httpErrors: app.httpErrors });
  const controller = makeShipmentsController({ service });

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
