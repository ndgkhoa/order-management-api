import { Type, type Static } from '@sinclair/typebox';
import type { InferSelectModel } from 'drizzle-orm';
import type { orders, orderItems } from '@infra/db/schema';

export type OrderRow = InferSelectModel<typeof orders>;
export type OrderItemRow = InferSelectModel<typeof orderItems>;

export const CreateOrderBody = Type.Object({
  items: Type.Array(
    Type.Object({
      productId: Type.String({ format: 'uuid' }),
      quantity: Type.Integer({ minimum: 1, maximum: 10_000 }),
    }),
    { minItems: 1, maxItems: 100 },
  ),
});
export type CreateOrderBody = Static<typeof CreateOrderBody>;

export const IdParams = Type.Object({ id: Type.String({ format: 'uuid' }) });

export const OrderItemPublic = Type.Object({
  productId: Type.String(),
  sku: Type.String(),
  unitPriceCents: Type.Integer(),
  quantity: Type.Integer(),
  lineTotalCents: Type.Integer(),
});
export type OrderItemPublic = Static<typeof OrderItemPublic>;

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

export const OrderDetail = Type.Composite([
  OrderPublic,
  Type.Object({ items: Type.Array(OrderItemPublic) }),
]);
export type OrderDetail = Static<typeof OrderDetail>;

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

export type SnapshotProduct = {
  id: string;
  sku: string;
  priceCents: number;
};

export type OrderLine = {
  productId: string;
  skuSnapshot: string;
  unitPriceCents: number;
  quantity: number;
  lineTotalCents: number;
};

export type CreateOrderInput = {
  userId: string;
  lines: OrderLine[];
  totalCents: number;
};

export type CancelOrderInput = {
  orderId: string;
  requesterId: string;
  canCancelAny: boolean;
};
