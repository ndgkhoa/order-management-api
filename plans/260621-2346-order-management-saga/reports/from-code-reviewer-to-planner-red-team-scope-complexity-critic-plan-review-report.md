# Red-Team Plan Review — Scope & Complexity Critic (Contract Verifier)

Plan: `plans/260621-2346-order-management-saga/`
Lens: YAGNI enforcer + cross-phase contract verifier. Portfolio-grade demo.
High-risk areas (saga compensation, webhook HMAC, idempotency, over-sell, RBAC) are OUT of cut scope per instructions — findings target incidental gold-plating and contract inconsistency only.

---

## Finding 1: event_id / correlation_id columns + dedup migration are redundant — existing dedup already works per-event

- **Severity:** High
- **Location:** Phase 1, "Architecture" (DB migration) + "Implementation Steps" step 4-5
- **Flaw:** Phase 1 adds `outbox_messages.event_id uuid` and reworks `processed_messages` to dedup on `eventId` instead of the outbox row id. But the current code ALREADY dedups per-event using the outbox row `id` as `messageId`, which is one-row-per-event and globally unique. Adding a second uuid column that is just "backfill `event_id = id`" (the plan's own mitigation, phase-01:56) is a no-op rename that touches the live `order.created` path for zero behavioral gain.
- **Failure scenario:** Migration + publisher + relay + consumer + repository all edited to thread a new id that is functionally identical to the existing primary key. High blast radius (the plan flags this as a risk itself) for a column that duplicates `outbox_messages.id`. Two dedup keys in flight during migration = the exact "mixed old/new key" hazard the plan warns against (phase-01:56).
- **Evidence:**
  - Existing dedup keyed on outbox row id: `src/infra/mq/outbox-relay.ts:59` (`messageId: row.id`) → `src/modules/orders/order-created-handler.ts:27,40-42` (insert `messageId` into `processed_messages` ON CONFLICT).
  - `processed_messages.messageId` already PK + already unique-per-event: `src/infra/db/schema.ts:52-55`.
  - `outbox_messages.id` is already `uuid primaryKey defaultRandom`: `src/infra/db/schema.ts:32`.
  - Plan's own backfill admission that the new col equals the old: `phase-01-foundation-event-envelope.md:56`.
- **Suggested fix:** Keep `correlation_id` (genuinely new — needed for saga tracing, `correlation_id = order_id`). DROP the `event_id` column and the dedup-key switch. Reuse the existing `outbox_messages.id` as the dedup key everywhere (it already is). The "versioned envelope" can carry `eventId = outbox row id` without a new column. Saves a migration and a risky edit to the live path.

---

## Finding 2: Envelope `eventId` (phase 1) and webhook `eventId` (phase 6) are different identifiers sharing one name — contract collision

- **Severity:** High
- **Location:** Phase 1 "Architecture" (envelope `eventId`) vs Phase 6 "Architecture" (webhook idempotency `processed:webhook:{eventId}`)
- **Flaw:** Phase 1 defines `eventId` as the outbox/envelope uuid used for consumer dedup. Phase 6 reuses the token `eventId` for the webhook dedup Redis key `processed:webhook:{eventId}`, but a webhook's dedup id must come from the _payment provider's_ payload (the inbound HTTP body), NOT the outbox envelope — the webhook is an inbound boundary, there is no outbox envelope on it. The plan never says where the webhook's `eventId` originates, so two phases use one name for two unrelated namespaces.
- **Failure scenario:** Implementer wires the webhook dedup to the envelope eventId (doesn't exist on inbound webhook) or to a self-generated id (defeats idempotency — every redelivery gets a fresh id and the "duplicate webhook → single side effect" guarantee silently breaks). The webhook-idempotency test (`phase-06:42`) could pass against a mock that reuses an id while production providers send their own.
- **Evidence:**
  - Phase 1 envelope: `phase-01-foundation-event-envelope.md:22` `{ eventId: uuid, ... }`, consumer dedup on it (`:22`, `:35`).
  - Phase 6 webhook dedup: `phase-06-payment-saga-webhook.md:29` `SETNX processed:webhook:{eventId}` with no defined source.
  - Inbound webhook has only the raw HMAC-signed body (`phase-06:27`), not an outbox envelope.
- **Suggested fix:** Rename the webhook dedup key to its real source, e.g. `processed:webhook:{providerEventId}` where `providerEventId` is a field in the mock provider's signed payload. State explicitly in phase 6 that this id is provider-supplied and distinct from the envelope eventId. One sentence resolves the collision.

---

## Finding 3: Idempotency plugin "generic + reusable across routes" is YAGNI — only POST /orders needs it

- **Severity:** Medium
- **Location:** Phase 5, "Architecture" ("Opt-in per route via config ... Keep generic + reusable") and "Requirements" ("`POST /orders` (and other mutating POSTs)")
- **Flaw:** Phase 5 builds a config-driven, per-route opt-in idempotency framework "for orders POST, later payments mock endpoints." But phase 5's own risk note contradicts this: "only POST /orders now; payment webhook has its OWN dedup (phase 6)" (`phase-05:50`). The mock-payment force endpoints (`POST /mock-payments/:id/{succeed,fail}`) are demo control levers, not client-retryable mutations — they don't need HTTP idempotency keys. So the "generic, multi-route, config-flag" machinery serves exactly one real route.
- **Failure scenario:** Time spent on route-registry config, per-route flags in `fastify.d.ts`, and abstraction that has a single caller — classic premature generalization. Reviewer/recruiter sees an idempotency framework with one user.
- **Evidence:**
  - Over-general claim: `phase-05-idempotency-rate-limit.md:21-22,26`.
  - Self-contradicting scope note: `phase-05-idempotency-rate-limit.md:50`.
  - Webhook has its own dedup (so payments don't need this plugin): `phase-06-payment-saga-webhook.md:29`.
- **Suggested fix:** Implement idempotency directly for `POST /orders` (still demonstrates the pattern fully). Drop the per-route config flag and `fastify.d.ts` config-flag edit (`phase-05:26`). If a second route ever needs it, generalize then. Keeps the demo's idempotency story intact while cutting unused indirection.

---

## Finding 4: Order status machine is inconsistent across phases 3/4/7 — no single source of truth at definition time

- **Severity:** High
- **Location:** Phase 3 "Architecture" vs Phase 4 "Architecture" vs Phase 7 "Architecture" (order-status transitions)
- **Flaw:** The status set and legal transitions are redefined incrementally in three phases with no canonical list:
  - Phase 3: `pending → paid → fulfilling → delivered`, plus `cancelled` (`phase-03:21`).
  - Phase 4: introduces `order-status.ts` with only `pending → cancelled` (`phase-04:23`).
  - Phase 7: extends to `paid → fulfilling → delivered`, `paid → cancelled` (refund), `pending → cancelled` (`phase-07:26`).
    Phase 3 lists `paid → fulfilling` and `fulfilling → delivered` as part of the machine, but the `order-status.ts` guard that owns those transitions isn't created until phase 4 and they aren't actually added to the guard until phase 7. Meanwhile the current code default is `'created'`, not `'pending'` — a third naming.
- **Failure scenario:** Phase 3 success criteria assert the full lifecycle exists, but the central guard (`order-status.ts`) doesn't encode `paid→fulfilling→delivered` until phase 7. An implementer following phase 3 either hand-rolls transition logic that phase 4 then duplicates in `order-status.ts`, or phase 3's claimed transitions are dead until phase 7. Risk of two transition definitions (phase-3 inline + phase-4 helper).
- **Evidence:**
  - Phase 3 transitions: `phase-03-order-aggregate-refactor.md:21`.
  - Phase 4 guard scope (only pending→cancelled): `phase-04-inventory-reservation-saga.md:23,33`.
  - Phase 7 guard extension: `phase-07-lifecycle-shipping.md:26`.
  - Current code uses `'created'` not `'pending'`: `src/infra/db/schema.ts:20`, `test/api/orders.test.ts:35`, `test/integration/order-flow.test.ts:102`.
- **Suggested fix:** Define the canonical status set + full transition table ONCE in `plan.md` (or phase 1) as the locked contract. Phases reference it; phase 4 creates `order-status.ts` with the COMPLETE transition map (even if some states aren't reachable until later phases) so it's defined once, not grown three times. Note the `created`→`pending` rename explicitly as a breaking change.

---

## Finding 5: order_status_history audit table is gold-plating for a demo

- **Severity:** Medium
- **Location:** Phase 7, "Architecture" (`order_status_history` table) + "Requirements" ("row written on every order transition")
- **Flaw:** A full append-only status-history audit table (`from_status, to_status, reason, created_at`) plus its writer module (`order-status-history.ts`), a dedicated migration column-set, and a unit test (`phase-07:40`) is added purely for auditing. It's not consumed by any saga step, any compensation path, any API the demo exercises, or any of the named high-risk areas. The saga's traceability story is already covered by `correlation_id` on every event + log line (`plan.md:30`) and by the OTel trace context already in the codebase.
- **Failure scenario:** Extra table + writer module + per-transition write coupling on the hot transition path, plus a test, for a feature nothing reads. Every transition site must remember to call the history writer (easy to miss → silent audit gaps that no demo flow detects).
- **Evidence:**
  - Table + module: `phase-07-lifecycle-shipping.md:25,32,33`.
  - No consumer of the history anywhere in plan (grep of phases 1-9 shows writes only, no reads).
  - Traceability already provided: `plan.md:30` (`correlation_id` on every event + log) and existing W3C trace context `src/infra/db/schema.ts:38-40`, `src/infra/mq/outbox-relay.ts:53`.
- **Suggested fix:** Cut `order_status_history` and `order-status-history.ts`. If a transition log is desired for the demo narrative, emit it as a structured log line in the existing `order-status.ts` guard (zero new schema). Frees the phase-7 migration to only add `shipments`.

---

## Finding 6: Admin manual shipment override (`PATCH /shipments/:id/status`) is unused scope

- **Severity:** Medium
- **Location:** Phase 7, "Requirements" / "Architecture" (Admin `PATCH /shipments/:id/status` manual advance)
- **Flaw:** The fake shipping worker already auto-advances `pending → ready_for_pickup → in_transit → delivered` on a timer (`phase-07:27`). A separate admin manual-advance endpoint duplicates the exact same state transitions through a second code path (controller + route + RBAC guard + status-machine call + event emit), demonstrating nothing the automated worker doesn't already demonstrate. RBAC (a named high-risk area) is already exercised by product admin CRUD (phase 2) and `GET /orders` (all).
- **Failure scenario:** Two writers to shipment status (worker timer + admin endpoint) create a race the plan doesn't address: admin advances to `delivered` while the timer also fires `in_transit` → conflicting transitions / double events. Added concurrency surface for a redundant feature.
- **Evidence:**
  - Auto worker advances all states: `phase-07-lifecycle-shipping.md:27`.
  - Manual override duplicates them: `phase-07-lifecycle-shipping.md:21,32`.
  - RBAC already covered elsewhere: `phase-02-product-catalog-cache.md:22`, `phase-07:21` (`GET /orders` all).
- **Suggested fix:** Cut `PATCH /shipments/:id/status`. RBAC is already demonstrated by admin product CRUD and admin order listing. If a manual lever is wanted for demoing, the existing `POST /mock-payments/:id/{succeed,fail}` force-endpoints already serve that "operator control" narrative.

---

## Finding 7: `adjust-stock.ts` shared helper is named in phase 6 but reserve logic is hand-written in phase 4 — DRY contract not honored at definition

- **Severity:** Medium
- **Location:** Phase 4 "Architecture" (inline atomic reserve UPDATE) vs Phase 6 "Architecture" (`src/modules/inventory/adjust-stock.ts` "shared helper, mirrors phase-4 reserve")
- **Flaw:** Phase 4 writes the atomic reserve as an inline `UPDATE products SET stock_available = stock_available - q ...` in the reserve handler (`phase-04:20`) and does NOT create a shared stock helper. Phase 6 then introduces `adjust-stock.ts` as a "shared helper" that "mirrors phase-4 reserve" (`phase-06:30,34`). So the reserve mutation is written once inline in phase 4, then a "shared" helper is created in phase 6 that the phase-4 code won't be using unless phase 4 is retro-fitted. The DRY abstraction is declared in the wrong phase.
- **Failure scenario:** Reserve logic lives inline in phase-4 handler; release logic lives in `adjust-stock.ts` from phase 6. Two divergent implementations of the same stock-column arithmetic (one for `-=`, one for `+=`) that the plan claims are "shared." A later sign/column bug fixed in one place isn't fixed in the other → over-sell or phantom stock (touches the over-sell high-risk area).
- **Evidence:**
  - Phase 4 inline reserve, no helper created: `phase-04-inventory-reservation-saga.md:20,26` (Create list has `order-status.ts` but no stock helper).
  - Phase 6 introduces "shared" helper retroactively: `phase-06-payment-saga-webhook.md:30,34`.
- **Suggested fix:** Create `src/modules/inventory/adjust-stock.ts` in PHASE 4 (where the first stock mutation lands) with `reserve()` and `release()`/`commit()` from the start. Phase 6 imports it instead of "mirroring." Move the helper's Create entry to phase 4's "Related Code Files." Resolves the cross-phase DRY contract at first use.

---

## Finding 8: Effort estimate ~50h vs migration/test count — schedule is optimistic but the per-phase scope is the lever

- **Severity:** Medium
- **Location:** `plan.md` frontmatter (`effort: ~50h (9 phases)`) + per-phase migrations (0002–0007)
- **Flaw:** 9 phases at the listed sub-totals (6+6+7+6+5+8+6+4+5) sum to 53h, but that excludes the TDD overhead the plan mandates (every phase "write failing tests first" across ~30 named test files) plus E2E timer-determinism work (`phase-09:52`). The migration count is fine (6 new: 0002 RBAC/envelope, 0003 products, 0004 orders reshape, 0005 cancel_reason, 0006 payments, 0007 shipments+history). But Findings 1 and 5 each carry a migration/column that's cuttable. The estimate isn't padded for the cross-phase contract churn (status machine redefined 3×, stock helper introduced late) that will cause rework.
- **Failure scenario:** Portfolio timeline slips; or quality is sacrificed on the named high-risk areas (the demo's actual selling point) to hit 50h, because effort was spent on the incidental scope in Findings 1, 3, 5, 6.
- **Evidence:**
  - Effort line: `plan.md:6`. Per-phase efforts: phase-0X frontmatter `effort:` fields.
  - Migration sequence across phases: `phase-01:28`, `phase-02:27`, `phase-03:26`, `phase-04:28`, `phase-06:35`, `phase-07:33`.
  - ~30 test files mandated TDD-first across phases (each phase "TDD — Tests First" section).
- **Suggested fix:** Adopt Findings 1/3/5/6 cuts (removes ~1 migration, 1 table, 1 endpoint, 1 plugin config layer ≈ 4-6h) and reinvest that into the high-risk areas (compensation idempotency edge cases, HMAC timing-safe verification, over-sell concurrency tests). Net effort roughly flat, but spent on what the demo is actually judged on.

---

## Cross-cutting contract verification summary

- **OrderCreated payload (phase 3) vs reserve consumer (phase 4):** CONSISTENT. Phase 3 payload `items:[{productId, sku, unitPriceCents, quantity}]` (`phase-03:22`) carries `productId` + `quantity` — exactly what phase-4's per-item `UPDATE ... WHERE id=? AND stock_available>=q` needs (`phase-04:20`). OK. Note: current code's `OrderCreatedPayload` is single-product (`src/infra/mq/outbox-event-types.ts:7-14`) — phase 3 is a deliberate breaking reshape, correctly flagged at `phase-03:50`.
- **InventoryReserved payload vs phase 6:** `InventoryReserved { orderId, items }` (`phase-04:22`). Phase 6 commits/releases per-item stock (`phase-06:20-21`), so it needs `items[{productId, quantity}]`. Phase 4 says only `{ orderId, items }` without item shape — UNDER-SPECIFIED but not contradictory; recommend phase 4 pin the item shape to match phase-6's needs to avoid a re-query.
- **Topology routing keys:** current topology hardcodes only `order.created` bindings (`src/infra/mq/topology.ts:23`). Phases 4/6/7 each say "topology bindings updated" — consistent direction, but no phase owns the canonical routing-key registry; recommend a single `routing-keys.ts` const map (mirrors existing `outbox-event-types.ts` pattern at `src/infra/mq/outbox-event-types.ts:2-3`) rather than per-phase string literals.
- **SmsProvider stub (phase 8):** JUSTIFIED. The `NotificationProvider` interface is the abstraction being demonstrated; the SMS stub is explicitly TODO/no-transport (`phase-08:50`). Multi-channel interface with one real + one stub provider is a reasonable demo of the pattern, not gold-plating. Keep.
- **refund-on-cancel (phase 7):** BORDERLINE-KEEP. It exercises a real compensation path (payment→refunded + restock), which aligns with the saga-compensation high-risk area. Keep, but it depends on the cut decisions in Findings 5/6 to not balloon phase 7.

---

## Status / Summary / Concerns

**Status:** DONE
**Summary:** 8 findings. 1 High redundant-column/migration (event_id duplicates existing outbox id dedup), 2 High contract issues (eventId name collision across phase 1/6; order status machine redefined 3× with no canonical source), 1 High late-DRY (adjust-stock helper introduced phase 6 but reserve written inline phase 4). 4 Medium gold-plating cuts (idempotency over-generalization, order_status_history audit table, admin manual shipment override, optimistic effort). Named high-risk areas left intact per instructions.
**Concerns:** (1) Phase 1's event_id migration touches the live order.created path for no behavioral gain — verify against existing `messageId=row.id` dedup before implementing. (2) The status machine must be locked as ONE contract before phase 3, or transitions will be implemented twice. (3) Phase 4's InventoryReserved item shape is under-specified relative to phase 6's needs — pin it to avoid a re-query. Unresolved question: does the mock payment provider's signed payload include a stable provider-event-id for webhook dedup (Finding 2)? The plan must state its source.
