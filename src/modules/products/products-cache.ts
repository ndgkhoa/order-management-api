import type { Redis } from 'ioredis';
import type { InferSelectModel } from 'drizzle-orm';
import type { products } from '@infra/db/schema.js';

type ProductRow = InferSelectModel<typeof products>;

const LIST_KEY = 'catalog:list';
const itemKey = (id: string) => `catalog:item:${id}`;
const TTL_SECONDS = 300; // bounded TTL; correctness comes from invalidate-on-write

/**
 * Redis read-through cache for the PUBLIC (active-only) catalog. Admin reads bypass this
 * (they need inactive rows + freshness). Invalidation is broad (DEL list + item) on every
 * mutation — correctness over hit-rate. Dates are JSON-serialized as ISO strings, so cached
 * rows are revived back into Date objects on read to match the DB row shape.
 */
export function makeProductsCache(redis: Redis) {
  function revive(row: ProductRow): ProductRow {
    return { ...row, createdAt: new Date(row.createdAt), updatedAt: new Date(row.updatedAt) };
  }

  return {
    async getList(): Promise<ProductRow[] | null> {
      const cached = await redis.get(LIST_KEY);
      if (!cached) return null;
      return (JSON.parse(cached) as ProductRow[]).map(revive);
    },

    async setList(rows: ProductRow[]): Promise<void> {
      await redis.set(LIST_KEY, JSON.stringify(rows), 'EX', TTL_SECONDS);
    },

    async getItem(id: string): Promise<ProductRow | null> {
      const cached = await redis.get(itemKey(id));
      if (!cached) return null;
      return revive(JSON.parse(cached) as ProductRow);
    },

    async setItem(row: ProductRow): Promise<void> {
      await redis.set(itemKey(row.id), JSON.stringify(row), 'EX', TTL_SECONDS);
    },

    /** Broad invalidation after any product write. */
    async invalidate(id?: string): Promise<void> {
      const keys = id ? [LIST_KEY, itemKey(id)] : [LIST_KEY];
      await redis.del(...keys);
    },
  };
}

export type ProductsCache = ReturnType<typeof makeProductsCache>;
