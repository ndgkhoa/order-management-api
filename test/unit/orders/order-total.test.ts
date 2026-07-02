import { describe, it, expect } from 'vitest';
import { buildOrderTotals, type SnapshotProduct } from '@modules/orders/order-total.js';

const p = (id: string, sku: string, priceCents: number): SnapshotProduct => ({
  id,
  sku,
  priceCents,
});

describe('buildOrderTotals', () => {
  it('snapshots price + sku per line and sums the order total', () => {
    const products = new Map<string, SnapshotProduct>([
      ['a', p('a', 'SKU-A', 1000)],
      ['b', p('b', 'SKU-B', 250)],
    ]);
    const { lines, totalCents } = buildOrderTotals(
      [
        { productId: 'a', quantity: 2 },
        { productId: 'b', quantity: 3 },
      ],
      products,
    );

    expect(lines).toEqual([
      {
        productId: 'a',
        skuSnapshot: 'SKU-A',
        unitPriceCents: 1000,
        quantity: 2,
        lineTotalCents: 2000,
      },
      {
        productId: 'b',
        skuSnapshot: 'SKU-B',
        unitPriceCents: 250,
        quantity: 3,
        lineTotalCents: 750,
      },
    ]);
    expect(totalCents).toBe(2750);
  });

  it('throws on an unknown product id', () => {
    expect(() => buildOrderTotals([{ productId: 'missing', quantity: 1 }], new Map())).toThrowError(
      /unknown product missing/,
    );
  });
});
