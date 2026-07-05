export const USER_ROLES = ['customer', 'admin'] as const;

export type UserRole = (typeof USER_ROLES)[number];

export const UserRoles = {
  Customer: 'customer',
  Admin: 'admin',
} as const satisfies Record<string, UserRole>;
