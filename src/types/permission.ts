/**
 * RBAC permissions — the single source of truth for every capability the app guards.
 * Values follow `resource:action` (`:scope` suffix when an action is scoped, e.g. `order:read:all`).
 * Reference a permission through `Permissions` (grouped by resource) — never a bare string — so
 * call sites stay refactor-safe and discoverable (`Permissions.Order.` lists every order power).
 * The `Permission` union type is derived from this object, so the const is the only place to edit.
 *
 * Only capabilities actually enforced somewhere live here (no speculative permissions).
 * `:own`-scoped customer actions (create an order, read/cancel your OWN order) are NOT permissions
 * — they need only authentication + an ownership check. Permissions cover elevated/cross-tenant
 * powers a role must explicitly grant.
 */
export const Permissions = {
  // Product catalog (admin CRUD; public read of the active catalog needs no permission).
  Product: {
    Create: 'product:create',
    Read: 'product:read', // elevated read — also see inactive/soft-deleted products
    Update: 'product:update',
    Delete: 'product:delete',
  },
  // Orders (elevated scopes beyond the caller's own).
  Order: {
    ReadAll: 'order:read:all', // list every order, not just the caller's own
    CancelAny: 'order:cancel:any', // cancel an order the caller does not own
  },
  // Fulfilment / payments ops.
  Shipment: { Update: 'shipment:update' }, // advance a shipment's status manually
  Payment: { Force: 'payment:force' }, // drive a mock payment outcome (force succeed/fail)
} as const;

type PermissionGroups = typeof Permissions;

/** Union of every permission string, derived from `Permissions` (the single source of truth). */
export type Permission = {
  [Group in keyof PermissionGroups]: PermissionGroups[Group][keyof PermissionGroups[Group]];
}[keyof PermissionGroups];
