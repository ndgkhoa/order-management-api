import type { FastifyInstance, FastifyReply, FastifyRequest, FastifyBaseLogger } from 'fastify';
import type { Redis } from 'ioredis';
import { verifyWebhook, isFreshTimestamp } from '@modules/payments/webhook-signature.js';
import type { PaymentsService, SettleOutcome } from '@modules/payments/payments-service.js';
import type { WebhookBody } from '@modules/payments/payments-schema.js';
import {
  deliverPaymentResult,
  type MockProviderConfig,
} from '@modules/payments/mock-payment-provider.js';
import { sagaMetrics } from '@infra/telemetry/saga-metrics.js';

const WEBHOOK_DEDUP_TTL_SECONDS = 60 * 60 * 24; // 24h Redis fast-path (durable backstop in DB)

interface ControllerDeps {
  service: PaymentsService;
  redis: Redis;
  secret: string;
  skewMs: number;
  mockConfig: Pick<MockProviderConfig, 'webhookUrl' | 'secret'>;
  httpErrors: FastifyInstance['httpErrors'];
  log: FastifyBaseLogger;
}

/**
 * Webhook + mock force endpoints. The webhook verifies HMAC over the RAW bytes and the
 * timestamp freshness BEFORE any side effect (bad/stale → 401), then dedups (Redis fast-path
 * + the service's durable backstop) and settles the payment. Force endpoints are admin-only
 * (they drive the real saga commit) and simply post a signed result back to the webhook.
 */
export function makePaymentsController(deps: ControllerDeps) {
  const { service, redis, secret, skewMs, mockConfig, httpErrors, log } = deps;

  return {
    webhook: async (req: FastifyRequest, reply: FastifyReply) => {
      const signature = req.headers['x-signature'];
      const raw = req.rawBody ?? '';
      if (typeof signature !== 'string' || !verifyWebhook(secret, raw, signature)) {
        throw httpErrors.unauthorized('invalid webhook signature');
      }
      const body = req.body as WebhookBody;
      if (!isFreshTimestamp(body.timestamp, skewMs)) {
        throw httpErrors.unauthorized('stale webhook timestamp');
      }

      const key = `processed:webhook:${body.providerEventId}`;
      if (await redis.exists(key)) return reply.code(200).send({ status: 'duplicate' });

      const result = await service.settle({
        paymentId: body.paymentId,
        providerEventId: body.providerEventId,
        outcome: body.outcome,
      });
      if (result === 'applied') {
        if (body.outcome === 'SUCCEEDED') sagaMetrics.paymentsSucceeded.inc();
        else sagaMetrics.paymentsFailed.inc();
      }
      await redis.set(key, '1', 'EX', WEBHOOK_DEDUP_TTL_SECONDS);
      return reply.code(200).send({ status: result });
    },

    force: (outcome: SettleOutcome) => async (req: FastifyRequest, reply: FastifyReply) => {
      const { id } = req.params as { id: string };
      await deliverPaymentResult(mockConfig, id, outcome, log);
      return reply.code(202).send({ status: 'delivering', paymentId: id });
    },
  };
}

export type PaymentsController = ReturnType<typeof makePaymentsController>;
