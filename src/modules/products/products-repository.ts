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

export function makeProductsRepository(db: DB, redis: Redis) {
  return {
    revive(row: ProductRow): ProductRow {
      return { ...row, createdAt: new Date(row.createdAt), updatedAt: new Date(row.updatedAt) };
    },

    async create(input: CreateProductBody) {
      const rows = await db.insert(products).values(input).returning();
      const row = rows[0];
      if (!row) throw new Error('product insert returned no row');
      await redis.del(CATALOG_LIST_KEY);
      return row;
    },

    async update(id: string, patch: UpdateProductBody) {
      const rows = await db
        .update(products)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(products.id, id))
        .returning();
      const row = rows[0];
      if (row) await redis.del(CATALOG_LIST_KEY, catalogItemKey(id));
      return row;
    },

    async softDelete(id: string) {
      const rows = await db
        .update(products)
        .set({ active: false, updatedAt: new Date() })
        .where(eq(products.id, id))
        .returning();
      const row = rows[0];
      if (row) await redis.del(CATALOG_LIST_KEY, catalogItemKey(id));
      return row;
    },

    async findById(id: string) {
      return db.query.products.findFirst({ where: eq(products.id, id) });
    },

    async findActiveById(id: string) {
      const cached = await redis.get(catalogItemKey(id));
      if (cached) return this.revive(JSON.parse(cached) as ProductRow);
      const row = await db.query.products.findFirst({
        where: and(eq(products.id, id), eq(products.active, true)),
      });
      if (row) await redis.set(catalogItemKey(id), JSON.stringify(row), 'EX', CATALOG_TTL_SECONDS);
      return row;
    },

    async listAll() {
      return db.query.products.findMany({ orderBy: desc(products.createdAt) });
    },

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
