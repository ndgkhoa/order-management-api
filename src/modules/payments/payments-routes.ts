import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import type { FastifyRequest } from 'fastify';
import { Permissions } from '@/types/permission.js';
import { makePaymentsRepository } from '@modules/payments/payments-repository.js';
import { makePaymentsService } from '@modules/payments/payments-service.js';
import { makePaymentsController } from '@modules/payments/payments-controller.js';
import {
  WebhookBody,
  WebhookAck,
  PaymentIdParams,
  MockAck,
} from '@modules/payments/payments-schema.js';
import { errorResponses } from '@infra/http/error-responses.js';

export const paymentsRoutes: FastifyPluginAsyncTypebox = (app) => {
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, bodyStr, done) => {
    (req as FastifyRequest).rawBody = bodyStr as string;
    if (!bodyStr) {
      done(null, undefined);
      return;
    }
    try {
      done(null, JSON.parse(bodyStr as string));
    } catch (err) {
      (err as Error & { statusCode?: number }).statusCode = 400;
      done(err as Error, undefined);
    }
  });

  const paymentsRepo = makePaymentsRepository(app.db);
  const service = makePaymentsService({ paymentsRepo });
  const controller = makePaymentsController({
    service,
    redis: app.redis,
    secret: app.config.WEBHOOK_HMAC_SECRET,
    skewMs: app.config.WEBHOOK_TIMESTAMP_SKEW_MS,
    mockConfig: {
      webhookUrl: app.config.PAYMENT_WEBHOOK_URL,
      secret: app.config.WEBHOOK_HMAC_SECRET,
    },
    httpErrors: app.httpErrors,
    log: app.log,
  });

  app.post(
    '/webhooks/payment',
    {
      schema: {
        tags: ['payments'],
        body: WebhookBody,
        response: { 200: WebhookAck, ...errorResponses(400, 401) },
      },
    },
    controller.webhook,
  );

  const mockGuards = {
    preHandler: [app.authenticate, app.requirePermission(Permissions.Payment.Force)],
  };
  app.post(
    '/mock-payments/:id/succeed',
    {
      ...mockGuards,
      schema: {
        tags: ['payments'],
        params: PaymentIdParams,
        response: { 202: MockAck, ...errorResponses(401, 403) },
      },
    },
    controller.force('SUCCEEDED'),
  );
  app.post(
    '/mock-payments/:id/fail',
    {
      ...mockGuards,
      schema: {
        tags: ['payments'],
        params: PaymentIdParams,
        response: { 202: MockAck, ...errorResponses(401, 403) },
      },
    },
    controller.force('FAILED'),
  );

  return Promise.resolve();
};
