import { and, eq } from 'drizzle-orm';
import { payments, outboxMessages, processedMessages } from '@infra/db/schema.js';
import type { DB, Tx } from '@infra/db/client.js';
import {
  PAYMENT_SUCCEEDED_EVENT,
  PAYMENT_FAILED_EVENT,
  type PaymentSettledPayload,
} from '@infra/mq/outbox-event-types.js';
import { PaymentStatuses } from '@/types/payment-status.js';
import type { SettleInput, SettleResult } from '@modules/payments/payments-schema.js';
import { WEBHOOK_CONSUMER } from '@/constants/index.js';

/** Data access for payments. The settle path is the transactional exactly-once webhook handler. */
export function makePaymentsRepository(db: DB) {
  return {
    /**
     * Insert the single pending payment for an order. `onConflictDoNothing` on the unique
     * `order_id` makes a duplicate delivery a no-op (returns `undefined`) rather than a second row.
     */
    async insertPendingPayment(
      tx: Tx,
      orderId: string,
      amountCents: number,
    ): Promise<{ id: string } | undefined> {
      const [row] = await tx
        .insert(payments)
        .values({ orderId, amountCents })
        .onConflictDoNothing({ target: payments.orderId })
        .returning({ id: payments.id });
      return row;
    },

    /**
     * Compare-and-set the payment outcome: `pending → paid|failed`, only while still `pending`.
     * Zero rows updated → already terminal (or unknown id) → returns `undefined`, so a late/racing
     * webhook can never flip a settled payment. Returns the order id for the downstream event.
     */
    async applyPaymentOutcome(
      tx: Tx,
      paymentId: string,
      to: 'paid' | 'failed',
      providerEventId: string,
    ): Promise<{ orderId: string } | undefined> {
      const [row] = await tx
        .update(payments)
        .set({ status: to, providerEventId, updatedAt: new Date() })
        .where(and(eq(payments.id, paymentId), eq(payments.status, PaymentStatuses.Pending)))
        .returning({ orderId: payments.orderId });
      return row;
    },

    /**
     * Applies a verified webhook result to a payment, transactionally and exactly once:
     * durable dedup on `providerEventId` (the money-affecting backstop behind the Redis fast-path)
     * → compare-and-set `pending → paid|failed` → emit `payment.succeeded|failed` in the SAME tx.
     * `duplicate` = event already applied; `noop` = payment already terminal (or unknown id) so the
     * CAS matched nothing — either way no second side effect and no spurious event.
     */
    async settle({ paymentId, providerEventId, outcome }: SettleInput): Promise<SettleResult> {
      return db.transaction(async (tx) => {
        const inserted = await tx
          .insert(processedMessages)
          .values({ consumerName: WEBHOOK_CONSUMER, eventId: providerEventId })
          .onConflictDoNothing()
          .returning();
        if (inserted.length === 0) return 'duplicate';

        const to = outcome === 'SUCCEEDED' ? PaymentStatuses.Paid : PaymentStatuses.Failed;
        const row = await this.applyPaymentOutcome(tx, paymentId, to, providerEventId);
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
    },
  };
}

export type PaymentsRepository = ReturnType<typeof makePaymentsRepository>;
