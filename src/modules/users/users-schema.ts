import { Type, type Static } from '@sinclair/typebox';
import type { InferSelectModel } from 'drizzle-orm';
import type { users } from '@infra/db/schema.js';

/** Public user shape returned by the API — deliberately omits passwordHash. */
export const UserPublic = Type.Object({
  id: Type.String(),
  email: Type.String(),
  createdAt: Type.String(),
});
export type UserPublic = Static<typeof UserPublic>;

type UserRow = InferSelectModel<typeof users>;

/** Maps a DB row to the public DTO (Date → ISO string, hash dropped). */
export function toUserPublic(u: UserRow): UserPublic {
  return { id: u.id, email: u.email, createdAt: u.createdAt.toISOString() };
}
