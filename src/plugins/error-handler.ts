import fp from 'fastify-plugin';
import type { FastifyError } from 'fastify';
import { buildProblem, problemType, titleFor } from '@infra/http/problem-details';
import { captureError } from '@infra/telemetry/sentry';

export const errorHandlerPlugin = fp((app) => {
  app.setErrorHandler((err: FastifyError, req, reply) => {
    const status = err.statusCode ?? 500;
    if (status >= 500) {
      req.log.error({ err }, 'unhandled error');
      captureError(err);
    }
    reply.code(status).type('application/problem+json').send(buildProblem(err, req));
  });

  app.setNotFoundHandler((req, reply) => {
    reply
      .code(404)
      .type('application/problem+json')
      .send({
        type: problemType(404),
        title: titleFor(404),
        status: 404,
        detail: `Route ${req.method} ${req.url} not found`,
        instance: req.url,
        requestId: req.id,
      });
  });
});
