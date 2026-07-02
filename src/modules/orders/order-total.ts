/**
 * Pure order-total computation. Kept free of DB/HTTP so it is trivially unit-testable.
 * Given the requested items and a lookup of the products they reference, it snapshots
 * each product's SKU + unit price, computes line totals, and sums the order total.
 * Throws on an unknown product id — the caller (service) maps that to a 400.
 */

export interface RequestedItem {
  productId: string;
  quantity: number;
}

export interface SnapshotProduct {
  id: string;
  sku: string;
  priceCents: number;
}

export interface OrderLine {
  productId: string;
  skuSnapshot: string;
  unitPriceCents: number;
  quantity: number;
  lineTotalCents: number;
}

export interface OrderTotals {
  lines: OrderLine[];
  totalCents: number;
}

export function buildOrderTotals(
  items: RequestedItem[],
  productsById: Map<string, SnapshotProduct>,
): OrderTotals {
  const lines = items.map((item) => {
    const product = productsById.get(item.productId);
    if (!product) {
      throw new Error(`unknown product ${item.productId}`);
    }
    return {
      productId: product.id,
      skuSnapshot: product.sku,
      unitPriceCents: product.priceCents,
      quantity: item.quantity,
      lineTotalCents: product.priceCents * item.quantity,
    };
  });
  const totalCents = lines.reduce((sum, l) => sum + l.lineTotalCents, 0);
  return { lines, totalCents };
}
