import { Type, type Static } from '@sinclair/typebox';
import type { InferSelectModel } from 'drizzle-orm';
import type { orders, orderItems } from '@infra/db/schema.js';

/** Create-order body: a list of product references + quantities. Price is snapshotted
 *  server-side from the catalog, never trusted from the client. */
export const CreateOrderBody = Type.Object({
  items: Type.Array(
    Type.Object({
      productId: Type.String({ format: 'uuid' }),
      // Upper bound keeps line_total_cents / total_cents within Postgres int32 and caps
      // a single order's blast radius (rejected as 400, not a 500 overflow).
      quantity: Type.Integer({ minimum: 1, maximum: 10_000 }),
    }),
    { minItems: 1, maxItems: 100 },
  ),
});
export type CreateOrderBody = Static<typeof CreateOrderBody>;

export const OrderItemPublic = Type.Object({
  productId: Type.String(),
  sku: Type.String(),
  unitPriceCents: Type.Integer(),
  quantity: Type.Integer(),
  lineTotalCents: Type.Integer(),
});
export type OrderItemPublic = Static<typeof OrderItemPublic>;

/** Order header (summary) — used by the list endpoint for status polling. */
export const OrderPublic = Type.Object({
  id: Type.String(),
  userId: Type.String(),
  status: Type.String(),
  totalCents: Type.Integer(),
  currency: Type.String(),
  createdAt: Type.String(),
  updatedAt: Type.String(),
});
export type OrderPublic = Static<typeof OrderPublic>;

/** Order header + line items — returned by create (201) and GET /orders/:id. */
export const OrderDetail = Type.Composite([
  OrderPublic,
  Type.Object({ items: Type.Array(OrderItemPublic) }),
]);
export type OrderDetail = Static<typeof OrderDetail>;

type OrderRow = InferSelectModel<typeof orders>;
type OrderItemRow = InferSelectModel<typeof orderItems>;

export function toOrderPublic(o: OrderRow): OrderPublic {
  return {
    id: o.id,
    userId: o.userId,
    status: o.status,
    totalCents: o.totalCents,
    currency: o.currency,
    createdAt: o.createdAt.toISOString(),
    updatedAt: o.updatedAt.toISOString(),
  };
}

function toOrderItemPublic(i: OrderItemRow): OrderItemPublic {
  return {
    productId: i.productId,
    sku: i.skuSnapshot,
    unitPriceCents: i.unitPriceCents,
    quantity: i.quantity,
    lineTotalCents: i.lineTotalCents,
  };
}

export function toOrderDetail(o: OrderRow, items: OrderItemRow[]): OrderDetail {
  return { ...toOrderPublic(o), items: items.map(toOrderItemPublic) };
}
