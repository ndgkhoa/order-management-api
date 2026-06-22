# Red-Team Plan Review — Assumption Destroyer / Scope Auditor

Plan: `plans/260621-2346-order-management-saga/` (plan.md + phase-01..09)
Lens: hostile skeptic. Every finding grep-verified against codebase at `develop`.
Codebase root: `/Users/nguyendangkhoa/workspace/personal/order-management-api/`

---

## Finding 1: Consumer dedup is keyed on `messageId` (outbox row id), NOT `eventId` — the entire "switch to eventId" is under-specified and self-conflicting

- **Severity:** Critical
- **Location:** Phase 1, "Architecture" (dedup key migration) + "Risk Assessment"; depended on by Phase 4 idempotency, Phase 6 webhook idempotency, Phase 8 notification dedup.
- **Flaw:** The plan says "consumer dedup keyed on `eventId`" and proposes to "rename PK semantics → keep column `message_id` but populate with eventId, OR add `event_id`". But TWO independent mechanisms already produce the dedup key today and the plan reconciles neither:
  1. The dedup key the handler uses is `msg.properties.messageId`, set by the publisher to the **outbox row id** (`messageId: message.messageId` ← `row.id`), not any payload field.
  2. The envelope's `eventId` would be a NEW uuid inside the payload body. For the consumer to dedup on `eventId`, the publisher must also stamp `messageId = eventId` (or the handler must parse the body), AND the relay must guarantee row.id == eventId or stop using row.id. The plan keeps `messageId: row.id` wiring untouched in its file list.
- **Failure scenario:** If `event_id` is added to the envelope but the publisher keeps `messageId: row.id` and the handler keeps reading `msg.properties.messageId`, dedup still keys on row id — redelivery of the same logical event after a relay re-poll (new row? no; same row) dedups fine, but a re-EMIT (saga re-processes and writes a new outbox row with a fresh row id but same eventId) will NOT dedup → double reserve / double charge / double email. Conversely if they switch `messageId` to eventId but forget the relay republish path, the in-process retry republish (`ch.publish(... ...msg.properties)` in consumer.ts) preserves properties so that path is OK — but the cross-saga-step re-emit is not.
- **Evidence:**
  - `src/infra/db/schema.ts:48-54` — `processedMessages` PK is `message_id uuid`, comment: "`messageId` reuses the outbox row id as the dedupe key."
  - `src/modules/orders/order-created-handler.ts:30` — `const messageId = msg.properties.messageId as string | undefined;`
  - `src/infra/mq/publisher.ts:24` — `{ persistent: true, messageId: message.messageId, ... }`; `src/infra/mq/outbox-relay.ts:58` — `messageId: row.id`.
  - Plan quote (phase-01:23): "`processed_messages` dedup switches from outbox-row-id to `event_id` (rename PK semantics → keep column `message_id` but populate with eventId, OR add `event_id`). Keep one dedup key; document choice in migration comment."
- **Suggested fix:** Decide ONE: stamp `messageId = eventId` at publish time (relay sets `messageId: envelope.eventId`, and outbox row gets `event_id` column populated = the envelope id), and keep handler reading `msg.properties.messageId`. Spell out the publisher.ts + outbox-relay.ts edits in Phase 1's file list (currently both unlisted for the messageId change). State the invariant: dedup key == envelope.eventId at every emit site, including saga re-emits.

---

## Finding 2: `ioredis` is not a dependency and no phase installs it — every Redis feature (plugin, idempotency, webhook dedup, cache, rate-limit store) blocks on a missing package

- **Severity:** Critical
- **Location:** Phase 1 "Architecture" (`ioredis` client) + "Dependencies"; Phase 2 cache; Phase 5 rate-limit Redis store + idempotency; Phase 6 webhook dedup.
- **Flaw:** Plan repeatedly assumes `ioredis` is the client (`src/infra/redis/client.ts`, `fastify.redis`) and that `@fastify/rate-limit` redis store will use `fastify.redis`. But `ioredis` is not in `package.json` dependencies, and NO phase's Implementation Steps include `npm install ioredis`. Phase 1 step list jumps straight to "Implement `redis/client.ts`".
- **Failure scenario:** First `import Redis from 'ioredis'` fails typecheck/build; every Redis-dependent phase is blocked at step 3. Additionally `@fastify/rate-limit` v11 `redis` option requires an **ioredis** instance specifically (not node-redis) — confirmed in plugin docs — so the choice is forced, not optional.
- **Evidence:**
  - `package.json:38-69` dependencies block — no `ioredis`, no `redis`. (rate-limit present at line 44: `"@fastify/rate-limit": "^11.0.0"`.)
  - `@fastify/rate-limit` docs: "This plugin requires the use of `ioredis`" and `redis: new Redis({...})` config option.
  - Plan quote (plan.md:60): "New infra: Redis (docker-compose service + `ioredis` plugin)." (phase-05:22): "`@fastify/rate-limit` redis option using `fastify.redis`".
- **Suggested fix:** Add an explicit "install `ioredis`" step in Phase 1 step 1 and list it under New dependencies. Note that `fastify.redis` (an ioredis instance) can be passed directly into `@fastify/rate-limit`'s `redis` option — that part is real.

---

## Finding 3: Single-queue topology — multiple new consumers (inventory, payment, notifications) will silently NOT receive events unless new queues+bindings are added; the plan assumes binding alone suffices

- **Severity:** Critical
- **Location:** Phase 4 "Architecture" (wire consumer to `OrderCreated`); Phase 6 (`InventoryReserved`/`PaymentCreated` consumers); Phase 7 (`OrderPaid` consumer); Phase 8 (notification consumer). All say "wire consumer bindings/routing keys in `topology.ts`."
- **Flaw:** Current topology declares ONE exchange (`order.events`, topic) and ONE queue (`order.created.email`) bound to `order.created`, consumed by ONE worker (`email-worker.ts` → `ORDER_EMAIL_QUEUE`). The plan treats "wire bindings" as the unit of work but never states that each saga step needs its OWN queue (RabbitMQ topic fan-out delivers to queues, not to "consumers"). If the inventory handler binds the SAME `order.created.email` queue to `order.created`, inventory and email will COMPETE for each message (round-robin), so ~half the orders get an email and the other half get reserved — not both. There is also no separate worker process defined for inventory/payment/shipping/notification consumers; only `email-worker.ts` exists, and Phase 4 vaguely says "modify `src/workers/email-worker.ts` or new consumer wiring."
- **Failure scenario:** Reserve fires but no email; or email fires but no reserve; saga stalls non-deterministically. With `prefetch=10` and competing consumers on one queue, messages are split, not duplicated → broken choreography under any load.
- **Evidence:**
  - `src/infra/mq/topology.ts:4,18-26` — exactly one main queue `ORDER_EMAIL_QUEUE = 'order.created.email'`, one binding to `ORDER_CREATED_EVENT`, one DLQ.
  - `src/workers/email-worker.ts:35-40` — only consumer, binds `ORDER_EMAIL_QUEUE`.
  - `src/infra/mq/consumer.ts:24,57-61` — generic consumer with `prefetch=10`, `noAck:false` (competing-consumer semantics on a shared queue).
  - Plan quote (phase-04:22): "Wire consumer bindings/routing keys in `topology.ts`." (phase-04:27): "`src/workers/email-worker.ts` or new consumer wiring".
- **Suggested fix:** Per saga step declare a dedicated durable queue (e.g. `inventory.reserve`, `payment.create`, `shipping.fulfil`, `notify`) each bound to its routing key(s), each with its own DLQ, each consumed by its own worker process. Add the worker process files to the file lists. State the rule: one queue per logical subscriber, never share a queue across handlers.

---

## Finding 4: Webhook HMAC verification needs the RAW request body, but the app registers a global JSON parser and no per-route raw-body support exists — plan hand-waves "register raw-body for the webhook route"

- **Severity:** High
- **Location:** Phase 6 "Architecture" (`webhook-signature.ts`, "verify uses timing-safe compare on the RAW body (register raw-body for the webhook route)") + Implementation Step 3 + Risk Assessment.
- **Flaw:** Fastify parses `application/json` globally by default; by the time a handler runs, `request.body` is a parsed object and the original byte stream is consumed. HMAC over a re-serialized object will mismatch the sender's signature (key order, whitespace, unicode escaping differ). The plan acknowledges this risk but its only mechanism is the parenthetical "register raw-body for the webhook route" — there is no `addContentTypeParser`, no `@fastify/raw-body`, and no raw-body plumbing anywhere in the codebase. `app.ts` registers no custom content-type parser.
- **Failure scenario:** Every legit webhook is rejected 401 (signature computed over re-serialized JSON ≠ provider's signature over original bytes), OR the dev "fixes" it by signing the parsed-then-reserialized body, which is brittle and breaks the moment a real provider sends differently-ordered JSON. Either way the HMAC test in `webhook-signature.test.ts` passes (it controls both sides) while production webhooks fail.
- **Evidence:**
  - `src/app.ts:40-58` — only `setValidatorCompiler` + plugin registration; no `addContentTypeParser`, no raw-body.
  - No `@fastify/raw-body` / `rawBody` anywhere: not in `package.json` deps (lines 38-69) nor src.
  - Plan quote (phase-06:27): "verify uses timing-safe compare on the RAW body (register raw-body for the webhook route)." (phase-06:60): "HMAC over parsed vs raw body mismatch → verify against RAW body".
- **Suggested fix:** Add a concrete step: install/configure raw-body capture scoped to the webhook route only (e.g. a route-scoped `addContentTypeParser('application/json', { parseAs: 'buffer' })` inside an encapsulated plugin, or `@fastify/raw-body` with `routes`-scoping), store the buffer, HMAC over it, then JSON.parse. Add it to Phase 6 file list and `package.json`. Add a test that signs raw bytes the handler did NOT serialize (e.g. with extra whitespace) to catch the re-serialization trap.

---

## Finding 5: RBAC assumes `users.role` and a role-bearing JWT exist — neither does; token payload is `{ sub, email }` only

- **Severity:** High
- **Location:** Phase 1 "Architecture" (RBAC: `users.role`, `requireRole('admin')` reading `request.user.role` from JWT, "JWT payload + sign updated to include `role`"). Depended on by Phase 2 admin CRUD, Phase 7 admin endpoints.
- **Flaw:** This is presented as an additive change but it is actually a breaking auth change with multiple coupled edits the plan underspecifies. `users` has no `role` column; `signToken` signs `{ sub, email }`; existing tokens in any running session/test fixtures carry no role. `requireRole('admin')` reading `request.user.role` will read `undefined` for every existing token → all admin routes 403 until tokens are re-minted. The plan lists the edits but not the migration default backfill semantics for existing users or token re-issue.
- **Failure scenario:** After migration, all pre-existing users default to `customer` (fine), but any integration test that logs in and expects admin access fails unless the test user is explicitly seeded with `role='admin'`. If `requireRole` does a strict `=== 'admin'` on a token minted before the `role` claim was added, it 403s — no admin can act until they re-login.
- **Evidence:**
  - `src/infra/db/schema.ts:4-9` — `users` table has id/email/passwordHash/createdAt only; no `role`.
  - `src/modules/auth/auth-service.ts:7,31` — `signToken: (payload: { sub: string; email: string })`; `return signToken({ sub: user.id, email: user.email });` — no role.
  - `src/plugins/jwt.ts:22` — `await request.jwtVerify();` sets `request.user` from token; nothing adds role.
  - Plan quote (phase-01:24): "JWT payload + sign updated to include `role`."
- **Suggested fix:** Spell out: (a) migration adds `role text not null default 'customer'`; (b) `signToken` signature + `auth-service` + every call site updated to include role from the user row; (c) `src/types/fastify.d.ts` `@fastify/jwt` `user` payload type augmented with `role`; (d) a seed/fixture path to create an admin; (e) note existing tokens are invalid for admin until re-login (acceptable in dev). All of (b)-(d) are coupled — flag as one atomic change.

---

## Finding 6: Hardcoded drizzle migration numbers will not match what `db:generate` actually emits — and Phase 3's orders reshape collides with the existing seeded `orders` shape used by current tests

- **Severity:** High
- **Location:** Phase 1 (`drizzle/0002_*.sql`), Phase 2 (`0003`), Phase 3 (`0004`), Phase 4 (`0005`), Phase 6 (`0006`), Phase 7 (`0007`).
- **Flaw:** Two problems. (1) drizzle-kit auto-assigns sequential numbers AND random slugs based on what is pending at generate time; the plan hardcodes `0002..0007` mapping one migration per phase, but several phases add multiple schema changes (Phase 7 adds `shipments` AND `order_status_history`; Phase 1 adds `users.role` + `outbox_messages.event_id` + `correlation_id`). If a phase generates 2 files, or phases are reordered, the numbers desync and later phase docs reference non-existent files. (2) Phase 3 reshapes `orders` (drops `product/quantity/amount`, renames `amount`→`total_cents`, adds `order_items`) — but `orders.status` default is currently `'created'` (not `'pending'`), and existing migration `0000` + tests (`reset-db.ts` TRUNCATE list, `order-flow.test.ts`) and `OrderCreatedPayload` (`product/quantity/amount`) all assume the old shape. The plan calls this "acceptable to drop in dev" but every downstream consumer (handler, payload, mail-adapter) reads the old fields.
- **Failure scenario:** A dev runs `db:generate` in Phase 1, gets `0002_some_slug.sql`, but Phase 4 doc says "create `drizzle/0005_*.sql`" — mismatch confuses tracking and the migration meta journal (`drizzle/meta`) drives ordering, not the doc. Worse, Phase 3 changing `orders.status` default from `'created'`→`'pending'` silently breaks any code path or test asserting `status='created'`.
- **Evidence:**
  - `drizzle/` currently: `0000_redundant_millenium_guard.sql`, `0001_short_gravity.sql` (random slugs, drizzle-assigned).
  - `src/infra/db/schema.ts:20` — `status: text('status').notNull().default('created')` (plan phase-03 wants default `'pending'`).
  - `src/infra/mq/outbox-event-types.ts:8-15` — `OrderCreatedPayload` has `product/quantity/amount` (reshaped away in phase 3).
  - `test/helpers/reset-db.ts:11` — TRUNCATE list is `processed_messages, outbox_messages, orders, users` (no products/order_items/payments/shipments — must be extended every phase or FK truncation fails).
  - Plan quote (phase-04:28): "Create migration: `drizzle/0005_*.sql`".
- **Suggested fix:** Drop the hardcoded numbers; say "run `db:generate`; commit whatever file it emits" and reference migrations by the schema change, not the number. Explicitly enumerate the `orders.status` default change (`created`→`pending`) and update `reset-db.ts` TRUNCATE list in EACH phase that adds a table (FK-ordered) — add this to every phase's steps.

---

## Finding 7: HTTP `Idempotency-Key` plugin design races against the outbox/onSend timing — "store on onSend after success" can store a 5xx or store before the DB tx is durable

- **Severity:** Medium
- **Location:** Phase 5 "Architecture" (SETNX processing marker → onSend stores `{status, body}`) + Risk Assessment ("store only AFTER handler success (onSend)").
- **Flaw:** Fastify's `onSend` runs for ALL responses including 4xx/5xx. The plan says store "after success" but onSend has no inherent success gate — the plugin must explicitly check `reply.statusCode < 400` or it will cache an error response and replay it forever for that key. Also: the order create commits inside `createWithOutbox`; onSend fires after the handler returns, which is after commit, so that ordering is OK — but the "processing" SETNX marker + 409 path has a gap: if the process crashes between commit and onSend-store, the key stays in "processing" state until TTL, and the retry gets a 409 even though the order WAS created → client cannot retrieve the original response. No reconciliation path is described.
- **Failure scenario:** (a) A validation 400 gets cached under the idempotency key; the client fixes the request, retries with the same key (common client behavior), and gets the stale 400 replayed — order never creatable with that key. (b) Crash-after-commit leaves a poisoned "processing" marker → 409 storm until TTL, duplicate-create risk if client rotates the key.
- **Evidence:**
  - `src/app.ts` — no idempotency plugin exists yet; design is greenfield so the gaps are pure plan gaps.
  - Plan quote (phase-05:20): "onSend hook stores `{status, body}` under the key with TTL." (phase-05:48): "store only AFTER handler success (onSend), keep a short 'processing' marker meanwhile."
- **Suggested fix:** Specify: only cache when `2xx` (do NOT cache 4xx/5xx — release the marker so the key is retryable); set a short TTL on the "processing" marker (e.g. 30s) distinct from the long success TTL so a crash self-heals; define the 409-while-processing contract. Add a test for "first request 400 → same key retried succeeds" and "crash mid-flight → key reusable after marker TTL".

---

## Finding 8: In-process timers for the mock payment delay AND shipping advances are lost on restart — and the E2E tests assume deterministic ticking that does not exist for these workers

- **Severity:** Medium
- **Location:** Phase 6 (mock provider "in-process timer", Risk Assessment); Phase 7 (fake shipping worker "schedules timed advances"); Phase 9 E2E tests ("drive workers deterministically (expose tick like the outbox relay)").
- **Flaw:** The outbox relay exposes a `tick()` for deterministic test-driving. The plan wants the same for mock-payment and shipping workers ("expose tick like the outbox relay") but Phases 6 and 7 design them as `setTimeout`-based self-scheduling timers, not tick-pollers. A `setTimeout` cannot be deterministically advanced by a test without fake timers, and fake timers interact badly with real Testcontainers I/O (RabbitMQ/Postgres awaits). Phase 9 asserts "correlationId consistent across events" through these timer-driven hops with only "make delays near-0" as mitigation — near-0 is still racy under loaded CI.
- **Failure scenario:** E2E tests flake: the assertion on final state runs before the timer-driven webhook self-call / shipping advance completes; or `vi.useFakeTimers()` freezes the awaits on real containers and the test hangs. Restart mid-saga (not tested) silently drops the in-flight payment/shipment with no recovery.
- **Evidence:**
  - `src/infra/mq/outbox-relay.ts:81` — `tick,` exposed "so tests can drive a single poll deterministically" — the pattern the plan wants to mirror but the new workers are designed as setTimeout.
  - Plan quote (phase-06:28): "schedules (in-process timer, delay from env `MOCK_PAYMENT_DELAY_MS`)"; (phase-06:62) "In-process timer for mock delay lost on restart → acceptable for portfolio". (phase-09:52): "drive workers deterministically (expose tick like the outbox relay)".
- **Suggested fix:** Design mock-payment and shipping workers as explicit `advance()`/`tick()` functions invoked by (a) a `setInterval` in prod and (b) directly by tests — same shape as the relay — instead of fire-and-forget `setTimeout`. Then E2E can call `tick()` and await deterministically with zero fake-timer fragility. Make this a Phase 6/7 design requirement, not a Phase 9 afterthought.

---

## Verified-as-TRUE plan claims (assumptions that held)

- "existing W3C trace-context capture" in orders-repository — TRUE: `src/modules/orders/orders-repository.ts:54-56` (`propagation.inject`), consumed by relay `outbox-relay.ts:53`.
- Real RabbitMQ publisher exists (not just a stub) — TRUE: `src/infra/mq/publisher.ts:16` `createRabbitPublisher`, wired in `src/server.ts:16`. (A log stub also exists for the relay's earlier phase but server uses the real one.)
- `@fastify/rate-limit` present and its `redis` option is real — TRUE: `package.json:44`; option confirmed in plugin docs (requires ioredis — see Finding 2).
- Testcontainers harness real — TRUE: `test/global-setup.ts` boots PG/RabbitMQ/Mailpit; adding a Redis `GenericContainer` is feasible with the existing pattern.
- `processed_messages` table exists — TRUE: `src/infra/db/schema.ts:48`, `drizzle/0000_*.sql:21` — but keyed on row id, see Finding 1.
- env-schema is extendable TypeBox — TRUE: `src/config/env-schema.ts` (add REDIS_URL/WEBHOOK_HMAC_SECRET/MOCK_PAYMENT_DELAY_MS/SHIPPING_STEP_MS as shown).

---

## Status / Summary / Concerns

**Status:** DONE_WITH_CONCERNS
**Summary:** 8 findings (3 Critical, 3 High, 2 Medium), all grep-verified with file:line. Plan's foundation claims are mostly accurate (trace-context, real publisher, rate-limit, testcontainers, processed_messages, env-schema all verified true), but five load-bearing assumptions are false or under-specified: the eventId dedup switch conflicts with the existing row-id keying (F1), `ioredis` is uninstalled and unscheduled (F2), the single-queue topology breaks multi-consumer choreography (F3), webhook raw-body has no plumbing (F4), and RBAC role/JWT do not exist yet (F5). Migration numbering is hardcoded against drizzle's auto-numbering and the orders reshape has unlisted ripple edits (F6).
**Concerns:** F1, F3, F4 are correctness-fatal to the saga and must be resolved in the plan before implementation, not discovered at runtime. F3 in particular silently splits messages rather than erroring — the most dangerous class.

## Unresolved questions

1. Is the dedup key intended to be `messageId == eventId` everywhere, or a new `processed_messages.event_id` column? Plan offers both; pick one and wire publisher/relay accordingly.
2. Will each saga step get its own worker process, or one multiplexing worker consuming multiple queues? Neither is stated.
3. Does the mock payment provider self-call the webhook over real HTTP (loopback) or invoke the controller in-process? Raw-body HMAC behavior differs between the two.
