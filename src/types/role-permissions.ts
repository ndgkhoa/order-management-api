import { type UserRole, UserRoles } from '@/types/user-role';
import { type Permission, Permissions } from '@/types/permission';

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
