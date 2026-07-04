import { and, eq } from 'drizzle-orm';
import type { OrderStatus } from '@/types/order-status.js';
import { orders } from '@infra/db/schema.js';
import type { Tx } from '@modules/inventory/adjust-stock.js';
import { assertTransition } from '@modules/orders/order-status.js';
import { recordOrderTransition } from '@modules/orders/order-status-history.js';

interface TransitionOptions {
  /** Audit reason written to order_status_history (e.g. 'payment_succeeded', 'out_of_stock'). */
  reason: string;
  /** Business cancel reason persisted on orders.cancel_reason (only when cancelling). */
  cancelReason?: string;
}

/**
 * The single guarded order status transition — every saga step routes its order status change
 * through here. It asserts the move is legal against the SSOT state machine, applies it with a
 * compare-and-set UPDATE (only while the row is still `from`), and — when a row actually
 * transitioned — appends the audit history row, all on the caller's transaction.
 *
 * Returns `true` if a row transitioned, `false` if the CAS matched nothing (lost race / already
 * terminal / duplicate delivery) so the caller can skip its side effects and events. MUST run
 * inside a `db.transaction` (it does no commit of its own).
 */
export async function transitionOrder(
  tx: Tx,
  orderId: string,
  from: OrderStatus,
  to: OrderStatus,
  { reason, cancelReason }: TransitionOptions,
): Promise<boolean> {
  assertTransition(from, to);
  const rows = await tx
    .update(orders)
    .set({
      status: to,
      updatedAt: new Date(),
      ...(cancelReason !== undefined ? { cancelReason } : {}),
    })
    .where(and(eq(orders.id, orderId), eq(orders.status, from)))
    .returning({ id: orders.id });
  if (rows.length === 0) return false;
  await recordOrderTransition(tx, { orderId, from, to, reason });
  return true;
}
