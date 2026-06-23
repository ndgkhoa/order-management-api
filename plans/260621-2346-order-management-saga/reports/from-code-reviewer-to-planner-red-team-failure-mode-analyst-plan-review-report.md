# Red-Team Plan Review — Failure Mode Analyst (Flow Tracer)

Plan: `plans/260621-2346-order-management-saga/` (Order Management Saga)
Reviewer lens: Murphy's Law / cascading failures / recovery gaps. Verification: end-to-end flow tracing against live code.
All findings grep/read-verified against actual codebase. No praise — findings only.

---

## Finding 1: Worker has NO outbox relay — every saga event emitted by a consumer is stranded forever

- **Severity:** Critical
- **Location:** Phase 4 ("Architecture" — "wraps reserve + dedup insert + outbox emit in ONE db tx (transactional outbox again)"), Phase 6 (InventoryReserved→PaymentCreated, PaymentSucceeded→OrderPaid), Phase 7 (OrderPaid→ShipmentCreated)
- **Flaw:** The plan's entire choreography depends on each consumer writing a new outbox row that "later" gets published. But the outbox relay is started ONLY in the API process. The worker process does not create or start a relay. A consumer running in the worker can INSERT an outbox row, but nothing in the worker publishes it. It only gets published if the API process's relay happens to poll the same DB — which it does (shared table), so it is not lost — BUT see the cascade in Finding 2: the relay sets `messageId = row.id`, and the dedup is global, so the chain still breaks. Even setting that aside, the plan never states WHERE the new consumers run (API vs worker) nor that the relay is the sole publisher. If a reviewer wires consumers in the worker assuming "transactional outbox again" gives them publish-on-commit, they get commit-but-never-publish unless the API relay is running.
- **Failure scenario:**
  1. Inventory consumer (in worker) handles `OrderCreated`, opens tx, reserves stock, inserts `InventoryReserved` outbox row, commits.
  2. Worker has no relay (`grep createOutboxRelay` → only `src/server.ts`).
  3. If the API process is down/restarting (deploy, crash), the row sits unpublished. Payment never starts. Order stuck `pending` forever, stock decremented (reserved), customer charged nothing, inventory leaked.
- **Evidence:** `src/server.ts:17,25` (`createOutboxRelay` + `relay.start()` only here). `grep -rln createOutboxRelay src/` → `src/server.ts` + `src/infra/mq/outbox-relay.ts` only. `src/workers/email-worker.ts:24-41` (worker `main()` starts a consumer, never a relay). Plan phase-04 line 21: "outbox emit in ONE db tx (transactional outbox again: reserve and the next event commit together)" — implies publish, but publish is decoupled and process-bound.
- **Suggested fix:** Phase 1 must explicitly state the relay is the ONLY publisher and runs in a known process that is always up, OR run a relay in the worker too. Document the consumer→outbox→relay topology per phase. Add a "saga stuck" recovery: a sweeper that detects `pending` orders with reserved stock older than N min.

## Finding 2: Single global `processed_messages` PK means fan-out consumers cannibalize each other's dedup — one consumer's processing permanently blocks all others for the same message

- **Severity:** Critical
- **Location:** Phase 1 ("DB migration... `processed_messages` dedup switches from outbox-row-id to `event_id`... Keep ONE dedup key"), Phase 4 line 17/52, Phase 8 line 23 (notification handler "dedup via processed_messages")
- **Flaw:** `processed_messages` is `messageId uuid PRIMARY KEY` — a SINGLE global table with no consumer/queue dimension. Phase 1 keeps "ONE dedup key." But the design fans the SAME event out to multiple queues/consumers: `OrderCreated` → email worker AND inventory consumer (phase 4); paid/cancelled/shipped → notification handler AND other consumers (phase 8). Each event carries one messageId/eventId. The FIRST consumer to `INSERT ... ON CONFLICT DO NOTHING` wins the row; the SECOND consumer sees `inserted.length === 0`, concludes "duplicate," and SKIPS its side effect entirely.
- **Failure scenario:**
  1. Relay publishes `OrderCreated` (one messageId) to exchange; topic binding fans to `order.created.email` AND a new `order.created.inventory` queue.
  2. Email worker processes first: inserts messageId into `processed_messages`, sends email, commits.
  3. Inventory consumer receives same messageId, tries insert → conflict → `duplicate=true` → returns without reserving stock.
  4. Order never reserved, never proceeds. OR reverse order: inventory wins, email never sends. Silent, no error, no retry.
- **Evidence:** `src/infra/db/schema.ts:52-55` (`processedMessages` PK = `message_id`, no consumer column). `src/modules/orders/order-created-handler.ts:38-45` (insert→conflict→`duplicate=true`→skip side effect). Plan phase-01 line 23 "Keep ONE dedup key"; phase-04 line 17 "via processed_messages dedup"; phase-08 line 23 "dedup via processed_messages." All share one key space.
- **Suggested fix:** Dedup key MUST be composite `(consumer_name/queue, eventId)` PK. Each consumer dedups independently. Phase 1 must redesign the table before any fan-out consumer is added, otherwise phases 4 and 8 silently break the email path that already works.

## Finding 3: PaymentSucceeded and PaymentFailed both processed → double stock mutation / order in contradictory state

- **Severity:** Critical
- **Location:** Phase 6 ("Requirements": PaymentSucceeded → reserved-=q; PaymentFailed → available+=q, reserved-=q; "Risk Assessment": "status guard: only release when order still pending/reserved")
- **Flaw:** A real (and mock-forceable) provider can deliver BOTH outcomes (succeed then fail, or two webhooks racing). The plan's only guard is "release only when order still pending/reserved" plus webhook eventId dedup. But the two webhooks have DIFFERENT eventIds (different payment events), so webhook dedup does not stop them. The status guard is described but the ordering/atomicity is not: if `PaymentSucceeded` sets order `paid` and does `reserved-=q`, then `PaymentFailed` arrives, the guard "still pending/reserved?" — order is now `paid`, not pending, so release is skipped — OK in that order. But REVERSE: `PaymentFailed` first releases `available+=q, reserved-=q` and cancels; then `PaymentSucceeded` runs — is there a guard rejecting paid-after-cancelled? Plan never specifies the `cancelled → paid` rejection. If missing, order flips to `paid` with stock already released → oversold + shipped.
- **Failure scenario:**
  1. Mock provider (or `POST /mock-payments/:id/fail` racing with default succeed) emits both `PaymentFailed` and `PaymentSucceeded` (distinct eventIds → webhook dedup passes both).
  2. `PaymentFailed` consumer: order `pending`→`cancelled`, `available+=q, reserved-=q`. Stock back to free pool.
  3. `PaymentSucceeded` consumer: no guard for `cancelled→paid` → sets order `paid`, `reserved-=q` → drives `stock_reserved` NEGATIVE (already 0) and emits `OrderPaid` → shipment created for stock that was released and possibly sold to someone else. Oversell + ship.
- **Evidence:** Plan phase-06 line 20-21 (both transitions defined), line 61 ("status guard: only release when order still pending/reserved; dedup webhook + outbox eventId") — guards the RELEASE direction only, not the COMMIT-after-cancel direction. `src/infra/db/schema.ts:20` order status is free-text `text` default, no DB-level state-machine enforcement. No `payment-status.ts` exists yet to verify; `grep` for it returns nothing (phase-06 creates it).
- **Suggested fix:** Both transitions must be guarded in ONE atomic `UPDATE orders SET status=? WHERE id=? AND status=<expected>` returning rows; zero rows → reject (already in terminal state). Explicitly reject `cancelled→paid` and `paid→cancelled` (the latter is a refund flow, not the failed-payment flow). Make stock adjust conditional on the guarded transition succeeding in the SAME tx.

## Finding 4: Reservation can be committed/released twice on consumer redelivery before the dedup row commits (no atomic guard on stock_reserved)

- **Severity:** High
- **Location:** Phase 4 line 20 (atomic reserve UPDATE), Phase 6 line 20-21 (commit/release), Phase 4 "Success Criteria": "No over-sell under concurrent orders (atomic UPDATE guarantees)"
- **Flaw:** The reserve UPDATE is guarded (`WHERE stock_available >= q`), but the COMMIT (`stock_reserved -= q`) and RELEASE (`stock_available += q, stock_reserved -= q`) have NO guard against running twice. Dedup is the only protection, and dedup insert + side effect are in one tx (good pattern, matches existing handler) — BUT RabbitMQ at-least-once + the consumer's in-process retry (`consumer.ts:46-51` re-publishes on retry) means the same logical event can be delivered concurrently to two channel deliveries if the broker redelivers before ack. Two concurrent txns both do `INSERT ON CONFLICT DO NOTHING` — one wins, one gets 0 rows and skips. That works ONLY if both serialize on the PK. They do (PK conflict blocks), so double-commit is actually prevented at the dedup layer — PROVIDED Finding 2 is fixed so the right consumer owns the key. However, `stock_reserved` has NO non-negative constraint (`schema.ts` will define it `default 0`, phase-02 says "stock never negative (DB check or guarded updates)" but commit/release UPDATEs in phase 4/6 are NOT guarded `WHERE stock_reserved >= q`). Any logic bug, replay, or the Finding-3 double-process drives `stock_reserved` negative silently.
- **Failure scenario:**
  1. `PaymentSucceeded` for order A commits `reserved-=2`.
  2. A redelivery or the Finding-3 race runs commit again before/around dedup (or dedup keyed wrong per Finding 2). `reserved` goes `0 → -2`.
  3. Negative reserved corrupts available-vs-reserved invariant; subsequent reserve math (`available -= q` while reserved is negative) miscomputes true free stock → oversell.
- **Evidence:** Plan phase-02 line 16 "stock never negative (DB check or guarded updates)" but phase-04 line 20 only guards the RESERVE (`WHERE stock_available >= q`); phase-06 line 20-21 commit/release UPDATEs have no `WHERE stock_reserved >= q`. `src/infra/db/schema.ts` has no CHECK constraint (current schema has no products table; phase-02 adds it without a CHECK in the plan text). Existing dedup pattern `order-created-handler.ts:37-48` is sound but global-keyed (Finding 2).
- **Suggested fix:** Add DB CHECK `stock_reserved >= 0` and `stock_available >= 0` on products. Guard commit/release UPDATEs with `WHERE stock_reserved >= q RETURNING` and treat zero-rows as an alarmable invariant violation, not a silent skip.

## Finding 5: Mock-provider in-process timer lost on restart strands orders in `pending` with NO recovery — acknowledged but unmitigated, and it cascades through the locked reservation

- **Severity:** High
- **Location:** Phase 6 line 28 (mock provider "in-process timer, delay from env"), line 62 ("In-process timer for mock delay lost on restart → acceptable for portfolio; note as known limitation")
- **Flaw:** The plan accepts the lost-timer limitation but does not trace the cascade. When the timer is lost, the order is not merely "pending payment" — its inventory is already RESERVED (phase 4 ran, `stock_available` decremented). So a lost timer = permanently leaked stock + permanently stuck order + no webhook will ever fire + no retry exists (the timer is not a queued message; nothing redelivers it). The `POST /mock-payments/:id/{succeed,fail}` endpoints can rescue it manually, but only if the operator knows the payment id. No sweeper, no timeout-to-cancel. For a portfolio demo this also means the E2E test (phase 9) is timer-dependent and flaky.
- **Failure scenario:**
  1. `InventoryReserved` → payment created → mock provider schedules `setTimeout(webhook, MOCK_PAYMENT_DELAY_MS)`.
  2. API process redeploys/crashes during the delay window.
  3. Timer gone. No webhook. No queued retry (the delay was an in-memory timer, not a delayed message). Order `pending`, stock reserved indefinitely. Inventory slowly leaks across every interrupted payment.
- **Evidence:** Plan phase-06 line 28 ("in-process timer"), line 62 (acknowledges loss, calls it acceptable, suggests "a real system would use a scheduled/delayed message" but does not add even a minimal recovery). No reaper/sweeper task anywhere in plan (grep of phases for "sweeper"/"reaper"/"timeout"/"reconcile" → none). Reservation already committed in phase-04 before payment.
- **Suggested fix:** Even for portfolio, add a periodic reaper: cancel + release reservation for orders `pending` with a reserved payment older than a payment-timeout. This demonstrates saga timeout handling (a plus for the portfolio narrative) and prevents permanent stock leak. Make the mock delay a queued delayed message if RabbitMQ delayed-exchange/TTL-DLX is available (topology already has DLX wiring at `topology.ts:5-7`).

## Finding 6: Cancel-after-paid restocks but the order may already be in shipping advance — status-guard race double-restocks or ships-then-restocks

- **Severity:** High
- **Location:** Phase 7 line 21 (customer cancel "allowed only pre-ship... cancel-after-paid triggers mock refund + restock"), line 57 ("Race: cancel vs shipping-advance → status guard + check-and-set")
- **Flaw:** The cancel endpoint and the fake-shipping worker both mutate order status concurrently with no shared lock — only a "check-and-set on current status" is described, but the two run in different processes (HTTP handler vs shipping worker timer) against free-text `orders.status`. The shipping worker advances `paid → fulfilling → ... → delivered` on timers; the cancel handler checks "is it pre-ship?" then refunds + restocks. Between the cancel handler's READ of status and its WRITE, the shipping worker can advance the order. Classic TOCTOU.
- **Failure scenario:**
  1. Order `paid`. Shipping worker timer about to fire `paid→fulfilling`.
  2. Customer `POST /orders/:id/cancel`. Handler reads status=`paid` → "pre-ship, allowed" → begins refund + `stock_available += q` (restock).
  3. Concurrently shipping worker sets `fulfilling` and emits `ShipmentInTransit`. Goods physically ship.
  4. Result: refunded AND restocked AND shipped. Stock double-counted (restocked units never came back), customer got goods for free.
- **Evidence:** Plan phase-07 line 27 (worker "schedules timed advances... updates order to fulfilling then delivered"), line 21 (cancel "guard by current status"), line 57 (only "check-and-set on current status"). `src/infra/db/schema.ts:20` status is unconstrained `text`. No row lock / `SELECT FOR UPDATE` / conditional UPDATE described for the cancel path. Two separate processes (orders-routes handler vs shipping worker) → no in-process mutex helps.
- **Suggested fix:** Cancel must be a single guarded `UPDATE orders SET status='cancelled' WHERE id=? AND status='paid' RETURNING` in the SAME tx as refund+restock; zero rows → 409 "already shipping." Shipping advance must likewise be guarded `WHERE status='paid'/'fulfilling'`. Restock conditional on the guarded transition committing.

## Finding 7: HMAC verify requires raw body, but webhook is also an idempotency/replay target — dedup uses Redis SETNX with TTL, creating a replay window after TTL expiry

- **Severity:** Medium
- **Location:** Phase 6 line 29 ("Webhook idempotency: Redis `SETNX processed:webhook:{eventId}` TTL; if exists → 200 no-op"), Phase 1 line 20 (`WEBHOOK_HMAC_SECRET`)
- **Flaw:** Webhook dedup lives in Redis with a TTL, separate from the durable `processed_messages` table. After the TTL expires, a replayed webhook with a still-valid HMAC signature (HMAC has no timestamp/nonce per the plan — `sign(payload)=HMAC_SHA256(secret, rawBody)`, no expiry) passes signature check AND passes dedup (Redis key gone) → side effect runs again. For a payment webhook this re-emits `PaymentSucceeded`/`PaymentFailed` → re-runs commit/release (compounding Finding 3/4). Also: Redis is a new boot dependency (phase 1 "fail-fast"); if Redis is briefly down, the webhook either 500s (provider retries → fine) or, if mis-coded to fail-open, every webhook bypasses dedup.
- **Failure scenario:**
  1. Provider/attacker captures a valid signed `PaymentSucceeded` webhook body+signature.
  2. Waits past the Redis dedup TTL.
  3. Re-POSTs. HMAC still valid (no timestamp in signed payload). Redis key expired → SETNX succeeds → treated as fresh → payment re-applied, `OrderPaid` re-emitted, second shipment created.
- **Evidence:** Plan phase-06 line 27 (`sign(payload)=HMAC_SHA256(secret, rawBody)` — no timestamp/nonce), line 29 (Redis SETNX with TTL, no durable backstop). Contrast durable `processed_messages` table (`schema.ts:52`) used for MQ dedup. No replay-window mitigation noted.
- **Suggested fix:** Include a timestamp in the signed payload and reject webhooks older than a short skew window (defeats post-TTL replay). Back webhook dedup with the durable `processed_messages` table (composite key per Finding 2), not only ephemeral Redis. Define explicit fail-CLOSED behavior when Redis/DB dedup store is unavailable.

## Finding 8: Idempotency-Key plugin stores response on `onSend` but the order create commit and the outbox publish are decoupled — replay can return "201 created" for an order whose event was never published

- **Severity:** Medium
- **Location:** Phase 5 line 20 ("onSend hook stores `{status, body}`"), line 48 ("store only AFTER handler success (onSend)")
- **Flaw:** `onSend` fires after the handler returns, i.e. after the order+outbox tx commits — fine for the order row. But the saga only progresses when the relay later publishes the outbox row. The idempotency layer captures and replays the 201 regardless of whether the saga ever advanced. Combined with Finding 1/2, a client that retries with the same Idempotency-Key gets a cached "201 pending" and assumes success, while the order may be stuck. Not a data-corruption bug, but it masks the stuck-saga failure mode from the client and from any retry-based self-healing. Also: the plan stores response under the key only on success; a request that commits the DB tx but crashes before `onSend` leaves the "processing" marker set → subsequent retries get 409 forever until TTL, even though the order WAS created (duplicate-create risk after TTL if client retries post-expiry against a now-unmarked key).
- **Failure scenario:**
  1. `POST /orders` with Idempotency-Key K. Tx commits (order+outbox row). Process crashes before `onSend` stores the response.
  2. Redis still holds the "processing" marker (set via SETNX at start). Client retries with K → 409 "processing" until marker TTL.
  3. After TTL, client retries K again → marker gone → SETNX succeeds → NEW order created (duplicate) because the original response was never stored and there is no link from K to the already-created order.
- **Evidence:** Plan phase-05 line 20 (SETNX processing marker → onSend stores), line 48 (store only after success), line 17 ("in-flight concurrency safe (lock or atomic SETNX while processing)"). No mention of reconciling the processing marker with an actually-committed order, nor of storing the order id under the key inside the create tx. Create tx is at `orders-repository.ts:20-58` (commits independently of any idempotency record).
- **Suggested fix:** Persist the idempotency record (key → order id / response) INSIDE the same DB tx as the order create, not in an `onSend` Redis write, so commit and idempotency record are atomic. Redis can be a fast-path cache layered on top. On retry, look up the durable record first.

---

## Cross-cutting observations (not separate findings)

- Free-text `orders.status` (`schema.ts:20`) with code-only guards: every status-race finding (3,6) traces back to no DB-level conditional transition. Strongly recommend all transitions be `UPDATE ... WHERE status=<expected> RETURNING` across phases 4/6/7.
- The existing consumer retry (`consumer.ts:46-51`) re-publishes via `ch.publish` then `ch.ack` — if publish succeeds but ack/process dies, you get an extra copy; all new consumers inherit this at-least-once behavior, so EVERY new handler must be idempotent with a correctly-scoped dedup key (Finding 2 is therefore load-bearing for the whole plan).

## Unresolved questions

1. Which process runs the new saga consumers (API vs worker vs a new process)? Plan never says. Determines whether Finding 1 is "stuck on restart" or "never publishes at all."
2. Does the mock provider emit a single outcome or can succeed+fail both fire? Plan's force endpoints suggest mutability — confirm only one terminal webhook is ever sent (Finding 3 severity hinges on this).
3. Is `processed_messages` intended to be reworked to a composite key in Phase 1, or kept single-key? Plan line 23 says "keep ONE dedup key" — if literal, Findings 2 breaks email+inventory fan-out.

---

**Status:** DONE
**Summary:** Reviewed plan.md + all 9 phases against live MQ/outbox/dedup code. 8 findings (3 Critical, 3 High, 2 Medium). Critical: worker lacks outbox relay (stranded saga events), single-global dedup key cannibalizes fan-out consumers, and unguarded succeed+fail double-processing causes oversell.
**Concerns:** The single global `processed_messages` PK (schema.ts:52) and the relay-only-in-API topology (server.ts:17) are foundational and silently break the email path the moment phase 4/8 add fan-out consumers. These must be redesigned in Phase 1 before downstream phases proceed.
