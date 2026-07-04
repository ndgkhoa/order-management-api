import { and, eq } from 'drizzle-orm';
import { payments } from '@infra/db/schema.js';
import type { Tx } from '@modules/inventory/adjust-stock.js';
import { PaymentStatuses } from '@/types/payment-status.js';

/**
 * Insert the single pending payment for an order. `onConflictDoNothing` on the unique
 * `order_id` makes a duplicate delivery a no-op (returns `undefined`) rather than a second row.
 */
export async function insertPendingPayment(
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
}

/**
 * Compare-and-set the payment outcome: `pending → paid|failed`, only while still `pending`.
 * Zero rows updated → already terminal (or unknown id) → returns `undefined`, so a late/racing
 * webhook can never flip a settled payment. Returns the order id for the downstream event.
 */
export async function applyPaymentOutcome(
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
}
