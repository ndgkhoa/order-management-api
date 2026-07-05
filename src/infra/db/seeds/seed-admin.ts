import argon2 from 'argon2';
import { db } from '@infra/db/client';
import { users } from '@infra/db/schema';
import { UserRoles } from '@/types/user-role';

const ADMIN_EMAIL = 'admin@orders.test';
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
