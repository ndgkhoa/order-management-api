import { eq } from 'drizzle-orm';
import type { DB } from '@infra/db/client.js';
import { users } from '@infra/db/schema.js';

/** Data access for users — Drizzle queries only, no business logic (Repository pattern). */
export function makeUsersRepository(db: DB) {
  return {
    findByEmail: (email: string) => db.query.users.findFirst({ where: eq(users.email, email) }),

    findById: (id: string) => db.query.users.findFirst({ where: eq(users.id, id) }),

    async create(input: { email: string; passwordHash: string }) {
      const rows = await db.insert(users).values(input).returning();
      const row = rows[0];
      if (!row) throw new Error('insert returned no row');
      return row;
    },
  };
}

export type UsersRepository = ReturnType<typeof makeUsersRepository>;
