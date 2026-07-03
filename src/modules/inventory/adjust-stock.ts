import { and, eq, gte, sql } from 'drizzle-orm';
import type { DB } from '@infra/db/client.js';
import { products } from '@infra/db/schema.js';

/** A Drizzle transaction handle (the callback arg of `db.transaction`). */
export type Tx = Parameters<Parameters<DB['transaction']>[0]>[0];

/**
 * Guarded stock mutations — the single implementation of the reserve/commit/release
 * arithmetic so every saga step shares the same guard. Each returns `true` only if a row
 * was actually updated; a `false` means the guard failed (insufficient stock) and the
 * caller must NOT proceed. The non-negative CHECK constraints on the columns are the last
 * line of defence.
 */

/** Reserve: `available -= q`, `reserved += q`, only if `available >= q`. */
export async function reserveStock(tx: Tx, productId: string, quantity: number): Promise<boolean> {
  const rows = await tx
    .update(products)
    .set({
      stockAvailable: sql`${products.stockAvailable} - ${quantity}`,
      stockReserved: sql`${products.stockReserved} + ${quantity}`,
      updatedAt: new Date(),
    })
    .where(and(eq(products.id, productId), gte(products.stockAvailable, quantity)))
    .returning({ id: products.id });
  return rows.length > 0;
}

/**
 * Commit a reservation on payment success: `reserved -= q`, only if `reserved >= q`.
 * `available` is NOT touched — it was already decremented at reserve time; the goods
 * simply leave the reserved hold.
 */
export async function commitReservation(
  tx: Tx,
  productId: string,
  quantity: number,
): Promise<boolean> {
  const rows = await tx
    .update(products)
    .set({
      stockReserved: sql`${products.stockReserved} - ${quantity}`,
      updatedAt: new Date(),
    })
    .where(and(eq(products.id, productId), gte(products.stockReserved, quantity)))
    .returning({ id: products.id });
  return rows.length > 0;
}

/**
 * Release a reservation on payment failure / compensation: `available += q`, `reserved -= q`,
 * only if `reserved >= q`. The guard makes a double-release a no-op (returns `false`) rather
 * than over-crediting available stock.
 */
export async function releaseReservation(
  tx: Tx,
  productId: string,
  quantity: number,
): Promise<boolean> {
  const rows = await tx
    .update(products)
    .set({
      stockAvailable: sql`${products.stockAvailable} + ${quantity}`,
      stockReserved: sql`${products.stockReserved} - ${quantity}`,
      updatedAt: new Date(),
    })
    .where(and(eq(products.id, productId), gte(products.stockReserved, quantity)))
    .returning({ id: products.id });
  return rows.length > 0;
}
