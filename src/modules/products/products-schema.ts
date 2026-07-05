import { Type, type Static } from '@sinclair/typebox';
import type { InferSelectModel } from 'drizzle-orm';
import type { products } from '@infra/db/schema.js';

export type ProductRow = InferSelectModel<typeof products>;

export const CreateProductBody = Type.Object({
  sku: Type.String({ minLength: 1, maxLength: 64 }),
  name: Type.String({ minLength: 1, maxLength: 200 }),
  description: Type.Optional(Type.String({ maxLength: 2000 })),
  priceCents: Type.Integer({ minimum: 0 }),
  stockAvailable: Type.Optional(Type.Integer({ minimum: 0 })),
  active: Type.Optional(Type.Boolean()),
});
export type CreateProductBody = Static<typeof CreateProductBody>;

export const UpdateProductBody = Type.Object({
  name: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
  description: Type.Optional(Type.String({ maxLength: 2000 })),
  priceCents: Type.Optional(Type.Integer({ minimum: 0 })),
  stockAvailable: Type.Optional(Type.Integer({ minimum: 0 })),
  active: Type.Optional(Type.Boolean()),
});
export type UpdateProductBody = Static<typeof UpdateProductBody>;

export const IdParams = Type.Object({ id: Type.String({ format: 'uuid' }) });

export const ProductPublic = Type.Object({
  id: Type.String(),
  sku: Type.String(),
  name: Type.String(),
  description: Type.String(),
  priceCents: Type.Integer(),
  stockAvailable: Type.Integer(),
  active: Type.Boolean(),
  createdAt: Type.String(),
  updatedAt: Type.String(),
});
export type ProductPublic = Static<typeof ProductPublic>;

export function toProductPublic(p: ProductRow): ProductPublic {
  return {
    id: p.id,
    sku: p.sku,
    name: p.name,
    description: p.description,
    priceCents: p.priceCents,
    stockAvailable: p.stockAvailable,
    active: p.active,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}
