import { orderStatusHistory } from '@infra/db/schema.js';
import type { Tx } from '@modules/inventory/adjust-stock.js';
import type { OrderStatus } from '@/domain/order-status.js';

/**
 * Appends one order status-transition audit row. MUST be called inside the same transaction
 * as the status change (and after the CAS that actually transitioned the row) so the trail
 * can never record a transition that didn't commit. `from` is null for the initial creation.
 */
export async function recordOrderTransition(
  tx: Tx,
  input: { orderId: string; from: OrderStatus | null; to: OrderStatus; reason?: string },
): Promise<void> {
  await tx.insert(orderStatusHistory).values({
    orderId: input.orderId,
    fromStatus: input.from,
    toStatus: input.to,
    reason: input.reason ?? null,
  });
}
