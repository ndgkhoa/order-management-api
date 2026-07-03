import { outboxMessages, processedMessages } from '@infra/db/schema.js';
import type { DB } from '@infra/db/client.js';
import {
  PAYMENT_SUCCEEDED_EVENT,
  PAYMENT_FAILED_EVENT,
  type PaymentSettledPayload,
} from '@infra/mq/outbox-event-types.js';
import { applyPaymentOutcome } from '@modules/payments/payments-repository.js';

/** Durable dedup dimension for inbound webhook events (keyed by provider event id). */
const WEBHOOK_CONSUMER = 'webhook';

export type SettleOutcome = 'SUCCEEDED' | 'FAILED';
export type SettleResult = 'applied' | 'duplicate' | 'noop';

interface SettleInput {
  paymentId: string;
  providerEventId: string;
  outcome: SettleOutcome;
}

/**
 * Applies a verified webhook result to a payment, transactionally and exactly once:
 * durable dedup on `providerEventId` (the money-affecting backstop behind the Redis fast-path)
 * → compare-and-set `pending → paid|failed` → emit `payment.succeeded|failed` in the SAME tx.
 * `duplicate` = event already applied; `noop` = payment already terminal (or unknown id) so the
 * CAS matched nothing — either way no second side effect and no spurious event.
 */
export function makePaymentsService({ db }: { db: DB }) {
  async function settle({
    paymentId,
    providerEventId,
    outcome,
  }: SettleInput): Promise<SettleResult> {
    return db.transaction(async (tx) => {
      const inserted = await tx
        .insert(processedMessages)
        .values({ consumerName: WEBHOOK_CONSUMER, eventId: providerEventId })
        .onConflictDoNothing()
        .returning();
      if (inserted.length === 0) return 'duplicate';

      const to = outcome === 'SUCCEEDED' ? 'paid' : 'failed';
      const row = await applyPaymentOutcome(tx, paymentId, to, providerEventId);
      if (!row) return 'noop';

      const payload: PaymentSettledPayload = { orderId: row.orderId, paymentId };
      await tx.insert(outboxMessages).values({
        aggregateType: 'order',
        aggregateId: row.orderId,
        correlationId: row.orderId,
        eventType: outcome === 'SUCCEEDED' ? PAYMENT_SUCCEEDED_EVENT : PAYMENT_FAILED_EVENT,
        payload,
      });
      return 'applied';
    });
  }

  return { settle };
}

export type PaymentsService = ReturnType<typeof makePaymentsService>;
