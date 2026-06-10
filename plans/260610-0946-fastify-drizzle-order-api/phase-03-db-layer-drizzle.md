# Phase 03 — DB Layer (Drizzle + node-postgres)

## Context Links

- Source of truth: [`docs/tech-stack.md`](../../docs/tech-stack.md) · Overview: [`plan.md`](./plan.md)
- Depends on: [Phase 02](./phase-02-local-infra-docker-compose.md) (postgres running).

## Overview

- **Priority:** P1 · **Status:** Pending
- **Description:** Drizzle `pg` Pool singleton, `drizzle.config.ts`, schema (`users`, `orders`, `outbox_messages`, `processed_messages`), `drizzle-kit generate` + `migrate` flow.

## Key Insights

- Pool is a **Singleton** created once (12-Factor: from `DATABASE_URL`). Both API and worker import the same `db` module → each process gets its own pool (fine).
- **Transactional Outbox** needs `orders` + `outbox_messages` written in ONE `db.transaction`. So both tables in same DB/schema (no cross-DB tx).
- **Idempotency** needs `processed_messages(message_id PK)` — worker checks-then-inserts inside its own tx to dedupe redelivery.
- Use `drizzle-kit generate` (SQL migration files committed) + `drizzle-kit migrate` at deploy. Do NOT use `push` in prod.

## Requirements

**Functional:** migrations create 4 tables; `db:studio` browses them.
**Non-functional:** typed schema → typed queries; UUID PKs; timestamps default now.

## Architecture

Repository layer (phases 05/06) consumes `db` + schema. `db` = Singleton. UoW = `db.transaction`.

## Related Code Files

**Create:**

- `src/infra/db/pool.ts` (pg Pool singleton + `closePool()`)
- `src/infra/db/client.ts` (`drizzle({ client: pool })` → export `db`)
- `src/infra/db/schema.ts` (all tables + relations) — split if >200 LOC into `schema/*.ts` re-exported
- `drizzle.config.ts` (root)
- generated: `drizzle/0000_*.sql`, `drizzle/meta/*`

## Implementation Steps

1. **Pool singleton** `src/infra/db/pool.ts`:
   ```ts
   import { Pool } from 'pg';
   export const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 10 });
   export const closePool = () => pool.end();
   ```
2. **Client** `src/infra/db/client.ts`:
   ```ts
   import { drizzle } from 'drizzle-orm/node-postgres';
   import { pool } from './pool.js';
   import * as schema from './schema.js';
   export const db = drizzle({ client: pool, schema });
   export type DB = typeof db;
   ```
3. **Schema** `src/infra/db/schema.ts`:

   ```ts
   import {
     pgTable,
     uuid,
     text,
     timestamp,
     integer,
     jsonb,
     boolean,
     index,
   } from 'drizzle-orm/pg-core';

   export const users = pgTable('users', {
     id: uuid('id').primaryKey().defaultRandom(),
     email: text('email').notNull().unique(),
     passwordHash: text('password_hash').notNull(),
     createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
   });

   export const orders = pgTable('orders', {
     id: uuid('id').primaryKey().defaultRandom(),
     userId: uuid('user_id')
       .notNull()
       .references(() => users.id),
     product: text('product').notNull(),
     quantity: integer('quantity').notNull(),
     amount: integer('amount').notNull(), // cents
     status: text('status').notNull().default('created'),
     createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
   });

   // Transactional Outbox
   export const outboxMessages = pgTable(
     'outbox_messages',
     {
       id: uuid('id').primaryKey().defaultRandom(),
       aggregateType: text('aggregate_type').notNull(), // 'order'
       aggregateId: uuid('aggregate_id').notNull(),
       eventType: text('event_type').notNull(), // 'order.created'
       payload: jsonb('payload').notNull(),
       publishedAt: timestamp('published_at', { withTimezone: true }), // null = unsent
       createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
     },
     (t) => ({ unpublishedIdx: index('outbox_unpublished_idx').on(t.publishedAt) }),
   );

   // Idempotent Consumer guard
   export const processedMessages = pgTable('processed_messages', {
     messageId: uuid('message_id').primaryKey(), // == outbox_messages.id reused as dedupe key
     processedAt: timestamp('processed_at', { withTimezone: true }).notNull().defaultNow(),
   });
   ```

4. **drizzle.config.ts**:
   ```ts
   import { defineConfig } from 'drizzle-kit';
   export default defineConfig({
     dialect: 'postgresql',
     schema: './src/infra/db/schema.ts',
     out: './drizzle',
     dbCredentials: { url: process.env.DATABASE_URL! },
   });
   ```
   (load env via `node --env-file=.env` or `dotenv` in npm script if needed.)
5. Run `npm run db:generate` → review SQL → commit. Then `npm run db:migrate` against compose postgres.
6. Verify with `npm run db:studio`.
7. Decide migration-on-deploy: a small `migrate.ts` using drizzle `migrate()` OR run `drizzle-kit migrate` as compose init step (phase 10 documents).

## Todo

- [ ] pool.ts singleton + closePool
- [ ] client.ts drizzle({client,schema})
- [ ] schema.ts (users, orders, outbox_messages, processed_messages) + index
- [ ] drizzle.config.ts
- [ ] generate migration, review, commit
- [ ] migrate against compose pg, verify in studio

## Success Criteria

- 4 tables exist; `outbox_unpublished_idx` present; FK orders.user_id→users.id.
- `db` importable, typed; migration SQL committed under `drizzle/`.

## Risk Assessment

- drizzle-kit not reading env → pass `DATABASE_URL` (use `--env-file` or dotenv). Document.
- Choosing `amount` as integer cents (avoid float money). Note in comment.

## Security Considerations

- No plaintext passwords stored — `password_hash` only (argon2 in phase 05).
- Pool `max` bounded to prevent connection exhaustion.

## Next Steps

Phase 04 wires `closePool` into graceful shutdown + `/ready` DB check (`SELECT 1`).
