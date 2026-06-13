import fp from 'fastify-plugin';
import type { FastifyError } from 'fastify';
import { buildProblem, problemType, titleFor } from '@infra/http/problem-details.js';

/**
 * Normalizes EVERY error into an RFC 7807 Problem Details response
 * (`application/problem+json`) with a `requestId`. Single source of error truth:
 * validation (400), httpErrors, JWT (401), rate-limit (429), unexpected (500),
 * and unknown routes (404) all share one shape.
 */
export const errorHandlerPlugin = fp((app) => {
  app.setErrorHandler((err: FastifyError, req, reply) => {
    const status = err.statusCode ?? 500;
    if (status >= 500) {
      req.log.error({ err }, 'unhandled error');
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
