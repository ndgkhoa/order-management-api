import { type UserRole, UserRoles } from '@/types/user-role.js';
import { type Permission, Permissions } from '@/types/permission.js';

/**
 * Role → permissions mapping — the single source of truth binding roles to capabilities.
 * A user carries one or more roles (`users.roles`); the union of their roles' permissions is
 * their effective permission set. Customers hold no cross-tenant permissions (they act on their
 * own resources via ownership checks); admins hold every guarded capability. Grant a capability
 * by adding its permission string to the relevant role's list here — routes stay unchanged.
 */
export const ROLE_PERMISSIONS: Record<UserRole, readonly Permission[]> = {
  [UserRoles.Customer]: [],
  [UserRoles.Admin]: [
    Permissions.Product.Create,
    Permissions.Product.Read,
    Permissions.Product.Update,
    Permissions.Product.Delete,
    Permissions.Order.ReadAll,
    Permissions.Order.CancelAny,
    Permissions.Shipment.Update,
    Permissions.Payment.Force,
  ],
};

/** True if any of the caller's roles grants `permission`. Unknown roles grant nothing (fail-closed). */
export function hasPermission(
  roles: readonly UserRole[] | undefined,
  permission: Permission,
): boolean {
  return (roles ?? []).some((role) => (ROLE_PERMISSIONS[role] ?? []).includes(permission));
}
