import { Type, type Static } from '@sinclair/typebox';
import type { InferSelectModel } from 'drizzle-orm';
import type { orders } from '@infra/db/schema.js';

export const CreateOrderBody = Type.Object({
  product: Type.String({ minLength: 1, maxLength: 200 }),
  quantity: Type.Integer({ minimum: 1 }),
  amount: Type.Integer({ minimum: 0 }), // cents
});
export type CreateOrderBody = Static<typeof CreateOrderBody>;

export const OrderPublic = Type.Object({
  id: Type.String(),
  userId: Type.String(),
  product: Type.String(),
  quantity: Type.Integer(),
  amount: Type.Integer(),
  status: Type.String(),
  createdAt: Type.String(),
});
export type OrderPublic = Static<typeof OrderPublic>;

type OrderRow = InferSelectModel<typeof orders>;

export function toOrderPublic(o: OrderRow): OrderPublic {
  return {
    id: o.id,
    userId: o.userId,
    product: o.product,
    quantity: o.quantity,
    amount: o.amount,
    status: o.status,
    createdAt: o.createdAt.toISOString(),
  };
}
