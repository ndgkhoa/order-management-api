export const Permissions = {
  Product: {
    Create: 'product:create',
    Read: 'product:read',
    Update: 'product:update',
    Delete: 'product:delete',
  },
  Order: {
    ReadAll: 'order:read:all',
    CancelAny: 'order:cancel:any',
  },
  Shipment: { Update: 'shipment:update' },
  Payment: { Force: 'payment:force' },
} as const;

type PermissionGroups = typeof Permissions;

export type Permission = {
  [Group in keyof PermissionGroups]: PermissionGroups[Group][keyof PermissionGroups[Group]];
}[keyof PermissionGroups];
