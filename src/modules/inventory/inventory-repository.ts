import { and, eq, gte, sql } from 'drizzle-orm';
import type { Tx } from '@infra/db/client.js';
import { products } from '@infra/db/schema.js';

/**
 * Guarded stock mutations — the single implementation of the reserve/commit/release arithmetic so
 * every saga step shares the same guard. Each method runs inside the CALLER's transaction (`tx`)
 * and returns `true` only if a row was actually updated; `false` means the guard failed
 * (insufficient stock) and the caller must NOT proceed. The non-negative CHECK constraints on the
 * columns are the last line of defence. The factory holds no state (methods take `tx`).
 */
export function makeInventoryRepository() {
  return {
    /** Reserve: `available -= q`, `reserved += q`, only if `available >= q`. */
    async reserve(tx: Tx, productId: string, quantity: number): Promise<boolean> {
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
    },

    /**
     * Commit a reservation on payment success: `reserved -= q`, only if `reserved >= q`.
     * `available` is NOT touched — it was already decremented at reserve time; the goods simply
     * leave the reserved hold.
     */
    async commit(tx: Tx, productId: string, quantity: number): Promise<boolean> {
      const rows = await tx
        .update(products)
        .set({
          stockReserved: sql`${products.stockReserved} - ${quantity}`,
          updatedAt: new Date(),
        })
        .where(and(eq(products.id, productId), gte(products.stockReserved, quantity)))
        .returning({ id: products.id });
      return rows.length > 0;
    },

    /**
     * Restock on refund of an already-PAID order: `available += q` only. The reservation was
     * already committed at payment (reserved returned to 0), so unlike `release` this does not
     * touch `reserved`. Always succeeds (adding stock can't violate the guards); returns `true` if
     * the product row existed.
     */
    async restock(tx: Tx, productId: string, quantity: number): Promise<boolean> {
      const rows = await tx
        .update(products)
        .set({
          stockAvailable: sql`${products.stockAvailable} + ${quantity}`,
          updatedAt: new Date(),
        })
        .where(eq(products.id, productId))
        .returning({ id: products.id });
      return rows.length > 0;
    },

    /**
     * Release a reservation on payment failure / compensation: `available += q`, `reserved -= q`,
     * only if `reserved >= q`. The guard makes a double-release a no-op (returns `false`) rather
     * than over-crediting available stock.
     */
    async release(tx: Tx, productId: string, quantity: number): Promise<boolean> {
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
    },
  };
}

export type InventoryRepository = ReturnType<typeof makeInventoryRepository>;
