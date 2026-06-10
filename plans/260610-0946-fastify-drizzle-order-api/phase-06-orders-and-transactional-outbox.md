# Phase 06 — Orders Module + Transactional Outbox

## Context Links

- Source of truth: [`docs/tech-stack.md`](../../docs/tech-stack.md) · Overview: [`plan.md`](./plan.md)
- Depends on: [Phase 05](./phase-05-auth-and-users-module.md) (authenticate, db), [Phase 03](./phase-03-db-layer-drizzle.md) (outbox table).
- Note: actual RabbitMQ publish + topology comes in [Phase 07](./phase-07-rabbitmq-and-email-worker.md). This phase writes the outbox row + relay skeleton; relay publishes via the phase-07 publisher.

## Overview

- **Priority:** P1 (CORE LEARNING) · **Status:** Pending
- **Description:** orders route/controller/service/repository. `create-order` writes `orders` row + `outbox_messages` row in ONE transaction (Transactional Outbox). Outbox relay = polling publisher reading unsent rows, publishing `order.created`, marking sent.

## Key Insights

- **Why outbox?** Can't atomically "INSERT order" AND "publish to RabbitMQ" — two systems, no shared tx. If you publish then DB rollback → ghost event; if DB commits then publish fails → lost event. Outbox makes the EVENT part of the SAME DB tx; a separate relay publishes later. At-least-once delivery → consumer must be idempotent (phase 07).
- Relay = simple poll loop (KISS). Production-grade enough for learning; CDC/Debezium is the heavier alternative (YAGNI here).
- `outbox_messages.id` is reused as the **dedupe key** (message id) → consumer writes it to `processed_messages`.
- API responds IMMEDIATELY after commit — does not wait for publish or email. That's the whole point.

## Requirements

**Functional:** POST `/orders` (auth) → 201 with order; row in outbox unsent; relay publishes within poll interval then sets `published_at`.
**Non-functional:** order+outbox atomic; relay at-least-once; relay survives publish failures (retries next tick).

## Architecture

```
POST /orders (authenticate)
  → orders-service.create(userId, dto)
      db.transaction(tx):
        order = tx.insert(orders)...returning
        tx.insert(outbox_messages){ aggregateId: order.id, eventType:'order.created', payload }
      (commit) → return order            // API done, fast

Outbox Relay (runs in API process OR worker — decide):
  every OUTBOX_POLL_INTERVAL_MS:
    rows = select outbox where published_at is null order by created_at limit N (FOR UPDATE SKIP LOCKED)
    for row: publisher.publish('order.events','order.created', row.payload, { messageId: row.id })
             update outbox set published_at = now() where id = row.id
```

## Related Code Files

**Create:**

- `src/modules/orders/orders-repository.ts` (createOrderWithOutbox tx, listByUser)
- `src/modules/orders/orders-service.ts`
- `src/modules/orders/orders-controller.ts`
- `src/modules/orders/orders-routes.ts`
- `src/modules/orders/orders-schema.ts` (CreateOrderBody, OrderPublic)
- `src/infra/mq/outbox-relay.ts` (polling publisher loop, start/stop)
- `src/infra/mq/outbox-event-types.ts` (event name constants, payload shape)
  **Modify:** `src/app.ts` (register orders routes `/orders`; start relay on ready / or in server.ts), `src/infra/db/schema.ts` (already has outbox).

## Implementation Steps

1. **orders-schema.ts**:
   ```ts
   export const CreateOrderBody = Type.Object({
     product: Type.String({ minLength: 1 }),
     quantity: Type.Integer({ minimum: 1 }),
     amount: Type.Integer({ minimum: 0 }), // cents
   });
   export const OrderPublic = Type.Object({
     id: Type.String(),
     userId: Type.String(),
     product: Type.String(),
     quantity: Type.Integer(),
     amount: Type.Integer(),
     status: Type.String(),
     createdAt: Type.String(),
   });
   ```
2. **orders-repository.ts** — atomic write:
   ```ts
   async createOrderWithOutbox(userId: string, dto: CreateOrder) {
     return db.transaction(async (tx) => {
       const [order] = await tx.insert(orders)
         .values({ userId, ...dto }).returning();
       await tx.insert(outboxMessages).values({
         aggregateType: 'order',
         aggregateId: order.id,
         eventType: 'order.created',
         payload: { orderId: order.id, userId, product: order.product,
                    quantity: order.quantity, amount: order.amount,
                    email: /* fetch or pass user email */ undefined },
       });
       return order;             // both committed together
     });
   }
   ```
   (Include recipient email in payload — pass from service via `request.user.email`, so worker needs no extra query.)
3. **orders-service.ts**: validate business rules (minimal), call repo, return order. DI factory receives `db`.
4. **orders-controller.ts**: `userId = request.user.sub`, body typed; map to `OrderPublic`.
5. **orders-routes.ts**:
   ```ts
   app.post(
     '/',
     {
       preHandler: app.authenticate,
       schema: { body: CreateOrderBody, response: { 201: OrderPublic } },
     },
     ctrl.create,
   );
   app.get(
     '/',
     { preHandler: app.authenticate, schema: { response: { 200: Type.Array(OrderPublic) } } },
     ctrl.list,
   );
   ```
   Register with prefix `/orders`.
6. **outbox-relay.ts** (depends on phase-07 publisher; build interface now, wire publish in 07):
   ```ts
   export function createOutboxRelay({ db, publisher, log, intervalMs }) {
     let timer: NodeJS.Timeout | null = null;
     let running = false;
     async function tick() {
       if (running) return;
       running = true;
       try {
         const rows = await db.execute(sql`
           SELECT * FROM outbox_messages WHERE published_at IS NULL
           ORDER BY created_at LIMIT 20 FOR UPDATE SKIP LOCKED`); // run inside a tx
         for (const row of rows) {
           await publisher.publish('order.events', row.event_type, row.payload, {
             messageId: row.id,
             persistent: true,
           });
           await db
             .update(outboxMessages)
             .set({ publishedAt: new Date() })
             .where(eq(outboxMessages.id, row.id));
         }
       } catch (e) {
         log.error(e, 'outbox relay tick failed');
       } finally {
         // next tick retries
         running = false;
       }
     }
     return {
       start() {
         timer = setInterval(tick, intervalMs);
       },
       async stop() {
         if (timer) clearInterval(timer);
       },
     };
   }
   ```
   Note: wrap SELECT...FOR UPDATE + publish + UPDATE so a row isn't double-locked; `SKIP LOCKED` lets multiple relays/instances coexist. For single-instance learning, a plain SELECT is fine — comment both.
7. **Where relay runs:** simplest = inside API process started in `server.ts` after listen; on shutdown call `relay.stop()` before `app.close()`. (Document alternative: run relay in worker process to decouple.)

## Todo

- [ ] orders-schema (CreateOrderBody, OrderPublic)
- [ ] orders-repository.createOrderWithOutbox (single tx) + listByUser
- [ ] orders-service + controller + routes (auth preHandler)
- [ ] outbox-event-types constants
- [ ] outbox-relay poll loop (FOR UPDATE SKIP LOCKED, mark published)
- [ ] start relay in server.ts; stop in graceful shutdown
- [ ] typecheck; verify outbox row created on POST /orders

## Success Criteria

- POST /orders 201 fast; `orders` + `outbox_messages` rows committed atomically.
- Forcing publish failure → `published_at` stays null, retried next tick (no data loss).
- After relay tick (with phase 07 wired) → `published_at` set + message in RabbitMQ.

## Risk Assessment

- Double publish if process crashes between publish and UPDATE → at-least-once → idempotent consumer (phase 07) absorbs it. Acceptable & intended.
- Relay running in API couples async work to web process — note tradeoff; fine for learning.

## Security Considerations

- `userId` taken from verified JWT (`request.user.sub`), never from body (prevents spoofing ownership).
- Payload contains user email (PII) — fine for Mailpit/dev; in prod keep payload minimal.

## Next Steps

Phase 07 implements the RabbitMQ publisher (used by relay) + topology + idempotent Email Worker.
