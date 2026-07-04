import argon2 from 'argon2';
import { db } from '@infra/db/client.js';
import { users } from '@infra/db/schema.js';
import { UserRoles } from '@/types/user-role.js';

/**
 * Seeds (or promotes) the bootstrap admin so RBAC-guarded routes are usable locally.
 * Credentials are intentionally hardcoded for local/dev convenience — NOT for production.
 * Idempotent: re-running upserts the same admin. Invoked by the seed runner (`db:seed`).
 */
const ADMIN_EMAIL = 'admin@orders.local';
const ADMIN_PASSWORD = 'admin1234';

export async function seedAdmin(): Promise<void> {
  const passwordHash = await argon2.hash(ADMIN_PASSWORD);
  const [row] = await db
    .insert(users)
    .values({ email: ADMIN_EMAIL, passwordHash, roles: [UserRoles.Admin] })
    .onConflictDoUpdate({ target: users.email, set: { roles: [UserRoles.Admin], passwordHash } })
    .returning();
  console.log(`  ✓ admin: ${row!.email} (roles=${row!.roles.join(',')})`);
}
