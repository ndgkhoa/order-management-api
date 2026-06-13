import { Type, type Static } from '@sinclair/typebox';

// Simple email pattern — validated by the TypeBox compiler (no ajv-formats needed).
const EMAIL_PATTERN = '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$';

export const RegisterBody = Type.Object({
  email: Type.String({ pattern: EMAIL_PATTERN, maxLength: 254 }),
  password: Type.String({ minLength: 8, maxLength: 128 }),
});
export type RegisterBody = Static<typeof RegisterBody>;

export const LoginBody = RegisterBody;
export type LoginBody = Static<typeof LoginBody>;

export const TokenResponse = Type.Object({
  accessToken: Type.String(),
});
export type TokenResponse = Static<typeof TokenResponse>;
