import { Type, type Static } from '@sinclair/typebox';

const EMAIL_PATTERN = '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$';

export const RegisterBody = Type.Object({
  email: Type.String({ pattern: EMAIL_PATTERN, maxLength: 254, examples: ['user@example.com'] }),
  password: Type.String({ minLength: 8, maxLength: 128, examples: ['password1234'] }),
});
export type RegisterBody = Static<typeof RegisterBody>;

export const LoginBody = RegisterBody;
export type LoginBody = Static<typeof LoginBody>;

export const TokenResponse = Type.Object({
  accessToken: Type.String(),
});
export type TokenResponse = Static<typeof TokenResponse>;
