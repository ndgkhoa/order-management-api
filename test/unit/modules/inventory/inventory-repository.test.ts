import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@infra/db/client.js';
import { products } from '@infra/db/schema.js';
import { makeInventoryRepository } from '@modules/inventory/inventory-repository.js';
import { resetDb } from '@test/helpers/reset-db.js';

const inventoryRepo = makeInventoryRepository();

async function seedProduct(available: number) {
  const [row] = await db
    .insert(products)
    .values({
      sku: `SKU-${crypto.randomUUID()}`,
      name: 'p',
      priceCents: 100,
      stockAvailable: available,
    })
    .returning();
  return row!;
}

describe('inventoryRepo.reserve (real Postgres)', () => {
  beforeEach(resetDb);

  it('moves available → reserved when stock suffices', async () => {
    const p = await seedProduct(10);
    const ok = await db.transaction((tx) => inventoryRepo.reserve(tx, p.id, 4));
    expect(ok).toBe(true);
    const [after] = await db.select().from(products).where(eq(products.id, p.id));
    expect(after!.stockAvailable).toBe(6);
    expect(after!.stockReserved).toBe(4);
  });

  it('returns false and mutates nothing when stock is insufficient', async () => {
    const p = await seedProduct(3);
    const ok = await db.transaction((tx) => inventoryRepo.reserve(tx, p.id, 5));
    expect(ok).toBe(false);
    const [after] = await db.select().from(products).where(eq(products.id, p.id));
    expect(after!.stockAvailable).toBe(3);
    expect(after!.stockReserved).toBe(0);
  });

  it('allows reserving exactly the available amount (boundary)', async () => {
    const p = await seedProduct(5);
    const ok = await db.transaction((tx) => inventoryRepo.reserve(tx, p.id, 5));
    expect(ok).toBe(true);
    const [after] = await db.select().from(products).where(eq(products.id, p.id));
    expect(after!.stockAvailable).toBe(0);
    expect(after!.stockReserved).toBe(5);
  });
});
