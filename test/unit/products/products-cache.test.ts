import { describe, it, expect, beforeEach } from 'vitest';
import type { Redis } from 'ioredis';
import type { InferSelectModel } from 'drizzle-orm';
import type { products } from '@infra/db/schema.js';
import { makeProductsCache } from '@modules/products/products-cache.js';

type ProductRow = InferSelectModel<typeof products>;

/** In-memory Redis stub: only the commands the cache uses (get/set/del). */
function fakeRedis(): Redis & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    get: (k: string) => Promise.resolve(store.get(k) ?? null),
    set: (k: string, v: string) => {
      store.set(k, v);
      return Promise.resolve('OK');
    },
    del: (...keys: string[]) => {
      let n = 0;
      for (const k of keys) if (store.delete(k)) n++;
      return Promise.resolve(n);
    },
  } as unknown as Redis & { store: Map<string, string> };
}

const row: ProductRow = {
  id: '11111111-1111-1111-1111-111111111111',
  sku: 'SKU-1',
  name: 'Widget',
  description: '',
  priceCents: 1500,
  stockAvailable: 10,
  stockReserved: 0,
  active: true,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
};

describe('products cache', () => {
  let redis: Redis & { store: Map<string, string> };
  let cache: ReturnType<typeof makeProductsCache>;
  beforeEach(() => {
    redis = fakeRedis();
    cache = makeProductsCache(redis);
  });

  it('list miss returns null, then hit returns revived rows (Dates restored)', async () => {
    expect(await cache.getList()).toBeNull();
    await cache.setList([row]);
    const hit = await cache.getList();
    expect(hit).toHaveLength(1);
    expect(hit![0]!.createdAt).toBeInstanceOf(Date);
    expect(hit![0]!.createdAt.toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });

  it('item round-trips and revives Dates', async () => {
    await cache.setItem(row);
    const hit = await cache.getItem(row.id);
    expect(hit!.id).toBe(row.id);
    expect(hit!.updatedAt).toBeInstanceOf(Date);
  });

  it('invalidate(id) removes both the list and the item key', async () => {
    await cache.setList([row]);
    await cache.setItem(row);
    await cache.invalidate(row.id);
    expect(await cache.getList()).toBeNull();
    expect(await cache.getItem(row.id)).toBeNull();
  });
});
