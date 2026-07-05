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

export function makePaymentsRepository(db: DB) {
  return {
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
