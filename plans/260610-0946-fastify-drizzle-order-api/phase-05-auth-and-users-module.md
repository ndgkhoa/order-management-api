# Phase 05 — Auth + Users Module

## Context Links

- Source of truth: [`docs/tech-stack.md`](../../docs/tech-stack.md) · Overview: [`plan.md`](./plan.md)
- Depends on: [Phase 04](./phase-04-fastify-core-and-health.md) (app builder, jwt plugin, db decorator).

## Overview

- **Priority:** P1 · **Status:** Pending
- **Description:** `register` (argon2 hash), `login` (issue JWT), `authenticate` decorator/preHandler, users repository/service, TypeBox request/response schemas, errors via `sensible` `httpErrors`.

## Key Insights

- Layered: `route → controller → service → repository`. Controller = HTTP glue; service = business logic + hashing; repository = Drizzle queries only. Keeps each file small + testable (service unit-tested without HTTP).
- argon2 (argon2id default) is async + memory-hard. Never log password. Compare with `argon2.verify`.
- JWT stateless: payload `{ sub: userId, email }`. `authenticate` preHandler calls `request.jwtVerify()` → sets `request.user`.
- TypeBox schema reused: define once, infer body type AND generate OpenAPI + AJV validation (DRY). Strip `passwordHash` from responses via explicit response schema.

## Requirements

**Functional:** POST `/auth/register` (201 + user, no hash), POST `/auth/login` (200 + accessToken), protected routes reject without/invalid token (401), duplicate email → 409.
**Non-functional:** password never stored/returned plaintext; validation 400 on bad body.

## Architecture

```
/auth/register → auth-controller.register → auth-service.register → users-repository.create
/auth/login    → auth-controller.login    → auth-service.login (verify) → jwt.sign
authenticate preHandler → request.jwtVerify() → request.user = {sub,email}
```

## Related Code Files

**Create:**

- `src/modules/users/users-repository.ts` (findByEmail, create)
- `src/modules/users/users-service.ts`
- `src/modules/users/users-schema.ts` (TypeBox: User, CreateUser DTOs)
- `src/modules/auth/auth-service.ts` (register/login, argon2, jwt)
- `src/modules/auth/auth-controller.ts`
- `src/modules/auth/auth-routes.ts`
- `src/modules/auth/auth-schema.ts` (RegisterBody, LoginBody, TokenResponse)
- `src/plugins/jwt.ts` (finalize: register `@fastify/jwt`, decorate `authenticate`)
  **Modify:** `src/app.ts` (register `authRoutes` with prefix `/auth`).

## Implementation Steps

1. **jwt plugin** (`fastify-plugin`):
   ```ts
   await app.register(fastifyJwt, {
     secret: app.config.JWT_SECRET,
     sign: { expiresIn: app.config.JWT_EXPIRES_IN },
   });
   app.decorate('authenticate', async (req, reply) => {
     try {
       await req.jwtVerify();
     } catch {
       throw app.httpErrors.unauthorized('invalid or missing token');
     }
   });
   ```
   Augment Fastify types: `interface FastifyInstance { authenticate: preHandler }`, `interface FastifyJWT { payload: {sub,email}; user: {sub,email} }`.
2. **users-schema.ts** (TypeBox):
   ```ts
   export const UserPublic = Type.Object({
     id: Type.String(),
     email: Type.String(),
     createdAt: Type.String(),
   });
   ```
3. **auth-schema.ts**:
   ```ts
   export const RegisterBody = Type.Object({
     email: Type.String({ format: 'email' }),
     password: Type.String({ minLength: 8, maxLength: 128 }),
   });
   export const LoginBody = RegisterBody;
   export const TokenResponse = Type.Object({ accessToken: Type.String() });
   ```
   (Enable AJV `format` via `ajv-formats` if email format needed — note dependency.)
4. **users-repository.ts**: `findByEmail(email)`, `create({email,passwordHash})` using `db`. Return rows typed from schema.
5. **auth-service.ts**:
   ```ts
   async register(email, password) {
     if (await usersRepo.findByEmail(email)) throw httpErrors.conflict('email already registered');
     const passwordHash = await argon2.hash(password); // argon2id
     return usersRepo.create({ email, passwordHash });
   }
   async login(email, password) {
     const u = await usersRepo.findByEmail(email);
     if (!u || !(await argon2.verify(u.passwordHash, password))) throw httpErrors.unauthorized('bad credentials');
     return app.jwt.sign({ sub: u.id, email: u.email });
   }
   ```
   (Pass `app`/`db`/`httpErrors` via factory function for DI — service receives deps, not globals.)
6. **auth-controller.ts**: parse `request.body` (typed), call service, map to response schema (`UserPublic` / `TokenResponse`).
7. **auth-routes.ts**:
   ```ts
   app.post(
     '/register',
     { schema: { body: RegisterBody, response: { 201: UserPublic } } },
     ctrl.register,
   );
   app.post(
     '/login',
     { schema: { body: LoginBody, response: { 200: TokenResponse } } },
     ctrl.login,
   );
   ```
8. Register in app.ts: `await app.register(authRoutes, { prefix: '/auth' });`
9. Add a protected sample `GET /users/me` (uses `preHandler: app.authenticate`) to demo auth.

## Todo

- [ ] jwt plugin + authenticate decorator + type augmentation
- [ ] users-schema, auth-schema (TypeBox + email format)
- [ ] users-repository (findByEmail, create)
- [ ] auth-service (argon2 hash/verify, jwt sign) via DI factory
- [ ] auth-controller + auth-routes (register/login) + response schemas hide hash
- [ ] register routes in app.ts with /auth prefix
- [ ] GET /users/me protected demo
- [ ] typecheck + manual: register→login→/users/me

## Success Criteria

- Register creates user, returns no password hash; duplicate → 409.
- Login returns valid JWT; `/users/me` 200 with token, 401 without.
- Bad body → 400 (AJV); response matches schema.

## Risk Assessment

- `format: 'email'` requires `ajv-formats` registered in validator compiler options. Document/add dep.
- Globals vs DI: prefer factory functions receiving deps to keep services unit-testable.

## Security Considerations

- argon2id hashing; constant-time verify. JWT secret ≥32 (enforced phase 01). Tokens short-lived (`JWT_EXPIRES_IN`). Never log password/hash. Rate-limit protects login (phase 04).

## Next Steps

Phase 06 adds orders, uses `authenticate` to bind `userId = request.user.sub`.
