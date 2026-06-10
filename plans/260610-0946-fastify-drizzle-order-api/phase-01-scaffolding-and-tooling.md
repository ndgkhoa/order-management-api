# Phase 01 — Project Scaffolding & Tooling

## Context Links

- Source of truth: [`docs/tech-stack.md`](../../docs/tech-stack.md)
- Overview: [`plan.md`](./plan.md)

## Overview

- **Priority:** P1 (foundation — blocks all)
- **Status:** Pending
- **Description:** Init Node 24 + TS project. Tooling: ESLint, Prettier, Husky+lint-staged+commitlint, tsx hot-reload. `@fastify/env` config schema. Folder skeleton. `.env.example`, `.gitignore`, `.dockerignore`.

## Key Insights

- `@fastify/env` validates env **at boot** (fail fast, 12-Factor). Schema = TypeBox/JSON Schema → typed `fastify.config`.
- Use ESM (`"type": "module"`) — Node 24 + tsx native ESM. tsconfig `"module": "NodeNext"`.
- Keep config in ONE place (`src/config/env-schema.ts`); every module reads `fastify.config`, never `process.env` directly (DRY + testable).
- **Path aliases (DECIDED: Option A):** use `@/`, `@config/`, `@infra/`, `@modules/`, `@plugins/` to avoid `../../../` in the deep module tree. Caveat to LEARN: `tsc` does NOT rewrite aliases on emit → add **`tsc-alias`** to the build (`tsc && tsc-alias`); tsx + `tsc --noEmit` read `paths` natively; Vitest needs **`vite-tsconfig-paths`**.
- **NodeNext ESM gotcha:** relative imports need explicit `.js` extension in source (e.g. `import './x.js'`). Aliased imports are rewritten by `tsc-alias` to correct relative `.js` paths at build.

## Requirements

**Functional:** `npm run dev` boots with hot reload; missing/invalid env aborts with clear error.
**Non-functional:** lint+format+commit hooks enforce quality pre-commit; strict TS.

## Architecture

12-Factor config: env → `@fastify/env` validate → `fastify.config` decorator (singleton). Single source of env truth.

## Related Code Files

**Create:**

- `package.json`, `tsconfig.json`, `.eslintrc.cjs` (or `eslint.config.js` flat), `.prettierrc`, `.prettierignore`
- `commitlint.config.cjs`, `.husky/pre-commit`, `.husky/commit-msg`, `lint-staged` config (in package.json)
- `.env.example`, `.gitignore`, `.dockerignore`, `.nvmrc` (24)
- `src/config/env-schema.ts` (TypeBox schema for @fastify/env)
- Empty skeleton dirs (with `.gitkeep`): `src/modules/{auth,users,orders}`, `src/infra/{db,mq,mail,telemetry}`, `src/plugins`, `src/workers`, `src/config`
- `src/app.ts`, `src/server.ts` (stubs, fleshed in phase 04)

## Implementation Steps

1. `npm init -y`; set `"type": "module"`, engines node `>=24`.
2. Install runtime deps:
   ```
   npm i fastify @fastify/env @fastify/sensible @fastify/cors @fastify/helmet \
     @fastify/rate-limit @fastify/jwt @fastify/swagger @fastify/swagger-ui \
     @fastify/type-provider-typebox @sinclair/typebox \
     drizzle-orm pg amqplib argon2 nodemailer pino pino-pretty
   ```
3. Install dev deps:
   ```
   npm i -D typescript tsx @types/node @types/pg @types/amqplib @types/nodemailer \
     drizzle-kit eslint @typescript-eslint/parser @typescript-eslint/eslint-plugin \
     eslint-config-prettier prettier husky lint-staged @commitlint/cli \
     @commitlint/config-conventional vitest @vitest/coverage-v8 testcontainers \
     tsc-alias vite-tsconfig-paths rimraf
   ```
4. `tsconfig.json`: `target ES2023`, `module NodeNext`, `moduleResolution NodeNext`, `strict true`, `outDir dist`, `rootDir src`, `esModuleInterop true`, `skipLibCheck true`. Add aliases:
   ```jsonc
   "baseUrl": "src",
   "paths": {
     "@/*": ["*"],
     "@config/*": ["config/*"],
     "@infra/*": ["infra/*"],
     "@modules/*": ["modules/*"],
     "@plugins/*": ["plugins/*"]
   }
   ```
   `tsc-alias` rewrites these to relative `.js` paths in `dist/` (tsc alone does NOT).
5. `package.json` scripts:
   ```json
   {
     "dev": "tsx watch src/server.ts",
     "dev:worker": "tsx watch src/workers/email-worker.ts",
     "clean": "rimraf dist",
     "build": "rimraf dist && tsc -p tsconfig.json && tsc-alias",
     "start": "node dist/server.js",
     "start:worker": "node dist/workers/email-worker.js",
     "lint": "eslint . --ext .ts",
     "format": "prettier --write .",
     "typecheck": "tsc --noEmit",
     "test": "vitest run",
     "test:cov": "vitest run --coverage",
     "db:generate": "drizzle-kit generate",
     "db:migrate": "drizzle-kit migrate",
     "db:studio": "drizzle-kit studio"
   }
   ```
6. ESLint flat config + `eslint-config-prettier`. Prettier: singleQuote, semi, printWidth 100.
7. `npx husky init`; pre-commit → `npx lint-staged`; commit-msg → `npx --no -- commitlint --edit $1`.
   lint-staged: `"*.ts": ["eslint --fix", "prettier --write"]`.
8. `src/config/env-schema.ts` — TypeBox object:
   ```ts
   import { Type } from '@sinclair/typebox';
   export const envSchema = Type.Object({
     NODE_ENV: Type.Union(
       [Type.Literal('development'), Type.Literal('production'), Type.Literal('test')],
       { default: 'development' },
     ),
     PORT: Type.Number({ default: 3000 }),
     LOG_LEVEL: Type.String({ default: 'info' }),
     DATABASE_URL: Type.String(),
     RABBITMQ_URL: Type.String(),
     JWT_SECRET: Type.String({ minLength: 32 }),
     JWT_EXPIRES_IN: Type.String({ default: '15m' }),
     SMTP_HOST: Type.String({ default: 'localhost' }),
     SMTP_PORT: Type.Number({ default: 1025 }),
     MAIL_FROM: Type.String({ default: 'no-reply@orders.local' }),
     OTEL_EXPORTER_OTLP_ENDPOINT: Type.Optional(Type.String()),
     SENTRY_DSN: Type.Optional(Type.String()),
     OUTBOX_POLL_INTERVAL_MS: Type.Number({ default: 1000 }),
   });
   ```
   Note: `@fastify/env` coerces strings→Number via AJV when `ajv.customOptions.coerceTypes` on.
9. `.env.example` mirrors schema (no real secrets). `.gitignore`: `node_modules dist .env *.log coverage`. `.dockerignore`: `node_modules dist .git .env plans coverage`.

## Todo

- [ ] `npm init`, set ESM + engines
- [ ] Install runtime + dev deps
- [ ] tsconfig strict NodeNext
- [ ] package.json scripts
- [ ] ESLint + Prettier configs
- [ ] Husky + lint-staged + commitlint
- [ ] `src/config/env-schema.ts`
- [ ] `.env.example`, `.gitignore`, `.dockerignore`, `.nvmrc`
- [ ] Folder skeleton + app.ts/server.ts stubs
- [ ] `npm run typecheck` passes on empty stubs

## Success Criteria

- `npm run typecheck` & `npm run lint` exit 0.
- Bad commit message rejected by commitlint; staged `.ts` auto-fixed.
- env schema imports cleanly.

## Risk Assessment

- ESM + tsx interop friction (CJS-only deps). Mitigate: NodeNext + `esModuleInterop`. amqplib/pg are CJS-compatible.
- Flat vs legacy ESLint config drift — pick flat config (ESLint 9).

## Security Considerations

- `.env` git-ignored; only `.env.example` committed. `JWT_SECRET` minLength 32 enforced at boot.

## Next Steps

Phase 02 (infra) needs this skeleton + `.dockerignore` + scripts.
