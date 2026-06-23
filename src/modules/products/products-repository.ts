import { and, desc, eq } from 'drizzle-orm';
import type { DB } from '@infra/db/client.js';
import { products } from '@infra/db/schema.js';
import type { CreateProductBody, UpdateProductBody } from '@modules/products/products-schema.js';

/** Data access for products — Drizzle queries only, no business logic (Repository pattern). */
export function makeProductsRepository(db: DB) {
  return {
    async create(input: CreateProductBody) {
      const rows = await db.insert(products).values(input).returning();
      const row = rows[0];
      if (!row) throw new Error('product insert returned no row');
      return row;
    },

    async update(id: string, patch: UpdateProductBody) {
      const rows = await db
        .update(products)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(products.id, id))
        .returning();
      return rows[0]; // undefined when no row matched
    },

    /** Soft delete: mark inactive so orders can still reference a withdrawn product. */
    async softDelete(id: string) {
      const rows = await db
        .update(products)
        .set({ active: false, updatedAt: new Date() })
        .where(eq(products.id, id))
        .returning();
      return rows[0]; // undefined when no row matched
    },

    findById: (id: string) => db.query.products.findFirst({ where: eq(products.id, id) }),

    findActiveById: (id: string) =>
      db.query.products.findFirst({ where: and(eq(products.id, id), eq(products.active, true)) }),

    listAll: () => db.query.products.findMany({ orderBy: desc(products.createdAt) }),

    listActive: () =>
      db.query.products.findMany({
        where: eq(products.active, true),
        orderBy: desc(products.createdAt),
      }),

    findBySku: (sku: string) => db.query.products.findFirst({ where: eq(products.sku, sku) }),
  };
}

export type ProductsRepository = ReturnType<typeof makeProductsRepository>;
