import { Type } from '@sinclair/typebox';
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { UserRoles } from '@/types/user-role.js';
import { makeShipmentsController } from '@modules/shipping/shipments-controller.js';
import { ShipmentPublic } from '@modules/shipping/shipments-schema.js';
import { errorResponses } from '@infra/http/error-responses.js';

const IdParams = Type.Object({ id: Type.String({ format: 'uuid' }) });

/** /shipments admin routes. Manual one-step advance (also the lost-timer recovery path). */
export const shipmentsRoutes: FastifyPluginAsyncTypebox = (app) => {
  const controller = makeShipmentsController({
    db: app.db,
    httpErrors: app.httpErrors,
    log: app.log,
  });

  app.patch(
    '/:id/status',
    {
      preHandler: [app.authenticate, app.requireRole(UserRoles.Admin)],
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
