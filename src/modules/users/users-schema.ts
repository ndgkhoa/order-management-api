import { Type, type Static } from '@sinclair/typebox';
import type { InferSelectModel } from 'drizzle-orm';
import type { users } from '@infra/db/schema';

export type UserRow = InferSelectModel<typeof users>;

export const UserPublic = Type.Object({
  id: Type.String(),
  email: Type.String(),
  createdAt: Type.String(),
});
export type UserPublic = Static<typeof UserPublic>;

export function toUserPublic(u: UserRow): UserPublic {
  return { id: u.id, email: u.email, createdAt: u.createdAt.toISOString() };
}
