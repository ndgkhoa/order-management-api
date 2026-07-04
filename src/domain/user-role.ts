/**
 * RBAC roles — single source of truth. Lives in src/types so the DB layer and the HTTP
 * layer both depend on it without coupling to each other. `USER_ROLES` drives the Drizzle
 * pg enum (`src/infra/db/schema.ts`), the `UserRole` union, and the named `UserRoles`
 * constants. Adding/renaming a role is a one-line change here.
 * Reference roles as `UserRoles.Admin`, never a bare string.
 */
export const USER_ROLES = ['customer', 'admin'] as const;

export type UserRole = (typeof USER_ROLES)[number];

export const UserRoles = {
  Customer: 'customer',
  Admin: 'admin',
} as const satisfies Record<string, UserRole>;
