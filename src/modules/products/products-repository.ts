import { and, desc, eq } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import type { DB } from '@infra/db/client.js';
import { products } from '@infra/db/schema.js';
import type {
  CreateProductBody,
  UpdateProductBody,
  ProductRow,
} from '@modules/products/products-schema.js';
import { CATALOG_LIST_KEY, catalogItemKey, CATALOG_TTL_SECONDS } from '@/constants/index.js';

/**
 * Data access for products — Drizzle queries only with an integrated Redis read-through cache.
 * Public reads (active-only) consult the cache then DB and populate it.
 * Admin reads (all incl. inactive) bypass the cache for freshness.
 * Writes invalidate the cache to preserve correctness over hit-rate.
 */
export function makeProductsRepository(db: DB, redis: Redis) {
  return {
    /** Revive JSON-serialised Dates back into Date objects after a cache read (pure, no I/O). */
    revive(row: ProductRow): ProductRow {
      return { ...row, createdAt: new Date(row.createdAt), updatedAt: new Date(row.updatedAt) };
    },

    async create(input: CreateProductBody) {
      const rows = await db.insert(products).values(input).returning();
      const row = rows[0];
      if (!row) throw new Error('product insert returned no row');
      // Broad invalidation: a new product changes the active list but has no item key yet.
      await redis.del(CATALOG_LIST_KEY);
      return row;
    },

    async update(id: string, patch: UpdateProductBody) {
      const rows = await db
        .update(products)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(products.id, id))
        .returning();
      const row = rows[0]; // undefined when no row matched
      if (row) await redis.del(CATALOG_LIST_KEY, catalogItemKey(id));
      return row;
    },

    /** Soft delete: mark inactive so orders can still reference a withdrawn product. */
    async softDelete(id: string) {
      const rows = await db
        .update(products)
        .set({ active: false, updatedAt: new Date() })
        .where(eq(products.id, id))
        .returning();
      const row = rows[0]; // undefined when no row matched
      if (row) await redis.del(CATALOG_LIST_KEY, catalogItemKey(id));
      return row;
    },

    /** Admin read: returns the product regardless of active flag (bypasses cache). */
    async findById(id: string) {
      return db.query.products.findFirst({ where: eq(products.id, id) });
    },

    /** Public read: cache read-through for active products only. */
    async findActiveById(id: string) {
      const cached = await redis.get(catalogItemKey(id));
      if (cached) return this.revive(JSON.parse(cached) as ProductRow);
      const row = await db.query.products.findFirst({
        where: and(eq(products.id, id), eq(products.active, true)),
      });
      if (row) await redis.set(catalogItemKey(id), JSON.stringify(row), 'EX', CATALOG_TTL_SECONDS);
      return row;
    },

    /** Admin read: all products newest first (bypasses cache). */
    async listAll() {
      return db.query.products.findMany({ orderBy: desc(products.createdAt) });
    },

    /** Public read: active-only catalog, cache read-through. */
    async listActive() {
      const cached = await redis.get(CATALOG_LIST_KEY);
      if (cached) return (JSON.parse(cached) as ProductRow[]).map((row) => this.revive(row));
      const rows = await db.query.products.findMany({
        where: eq(products.active, true),
        orderBy: desc(products.createdAt),
      });
      await redis.set(CATALOG_LIST_KEY, JSON.stringify(rows), 'EX', CATALOG_TTL_SECONDS);
      return rows;
    },

    async findBySku(sku: string) {
      return db.query.products.findFirst({ where: eq(products.sku, sku) });
    },
  };
}

export type ProductsRepository = ReturnType<typeof makeProductsRepository>;
