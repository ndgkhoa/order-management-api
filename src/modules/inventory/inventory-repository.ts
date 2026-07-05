import { and, eq, gte, sql } from 'drizzle-orm';
import type { Tx } from '@infra/db/client.js';
import { products } from '@infra/db/schema.js';

export function makeInventoryRepository() {
  return {
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
