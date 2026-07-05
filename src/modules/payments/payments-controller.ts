import type { FastifyInstance, FastifyReply, FastifyRequest, FastifyBaseLogger } from 'fastify';
import type { Redis } from 'ioredis';
import { verifyWebhook, isFreshTimestamp } from '@infra/http/webhook-signature';
import type { PaymentsService } from '@modules/payments/payments-service';
import type { SettleOutcome } from '@modules/payments/payments-schema';
import type { WebhookBody } from '@modules/payments/payments-schema';
import {
  deliverPaymentResult,
  type FakeProviderConfig,
} from '@modules/payments/fake-payment-provider';
import { sagaMetrics } from '@infra/telemetry/saga-metrics';
import { webhookDedupKey, WEBHOOK_DEDUP_TTL_SECONDS } from '@/constants/index';

interface PaymentsControllerDeps {
  service: PaymentsService;
  redis: Redis;
  secret: string;
  skewMs: number;
  mockConfig: Pick<FakeProviderConfig, 'webhookUrl' | 'secret'>;
  httpErrors: FastifyInstance['httpErrors'];
  log: FastifyBaseLogger;
}

export function makePaymentsController(deps: PaymentsControllerDeps) {
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

      const key = webhookDedupKey(body.providerEventId);
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
