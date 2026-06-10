# Phase 07 — RabbitMQ Infra + Idempotent Email Worker

## Context Links

- Source of truth: [`docs/tech-stack.md`](../../docs/tech-stack.md) · Overview: [`plan.md`](./plan.md)
- Depends on: [Phase 06](./phase-06-orders-and-transactional-outbox.md) (outbox relay calls publisher), [Phase 03](./phase-03-db-layer-drizzle.md) (`processed_messages`).

## Overview

- **Priority:** P1 (CORE LEARNING) · **Status:** Pending
- **Description:** amqplib connection singleton + reconnect, topology (exchange `order.events`, queue `order.created.email`, DLX + DLQ), publisher, worker entrypoint (`src/workers`) consuming idempotently (`processed_messages` check), retry + exponential backoff + DLQ on repeated failure, Nodemailer mail adapter (Adapter pattern) → Mailpit.

## Key Insights

- **Singleton connection + reconnect:** one connection, channels per concern. On `close`/`error` event → backoff reconnect. Both API (publisher) and worker share the same module logic.
- **Topology (assert idempotent):** topic exchange `order.events`; queue `order.created.email` bound to routing key `order.created`; queue arg `x-dead-letter-exchange = order.events.dlx`; DLX → `order.created.email.dlq`. Asserting is safe to repeat at boot.
- **Idempotent consumer:** message carries `messageId` (= outbox row id). Worker: in a DB tx, `INSERT INTO processed_messages(message_id)`; if unique-violation → already processed → `ack` & skip (dedupe). Else do side-effect (send email) then commit + ack. Send-before-commit vs commit-before-send: choose **insert processed → send → commit → ack**; if send fails, rollback (no processed row) + nack→retry. At-least-once email possible but rare; acceptable for learning (note exactly-once is impossible across email+DB).
- **Retry + backoff + DLQ:** track attempt via header `x-attempts` or per-message delay. Simple approach: on failure `nack(msg,false,false)` → goes to DLX/DLQ immediately after exhausting in-app retries; OR requeue with delay using a TTL retry queue. KISS path: try in-handler retries (e.g. 3 with `setTimeout` backoff) then `nack` (no requeue) → DLQ. Document the TTL-retry-queue alternative.

## Requirements

**Functional:** relay publish → worker consumes → email visible in Mailpit. Duplicate delivery → only one email. Permanent failure → message lands in DLQ, not infinite loop.
**Non-functional:** reconnect on broker restart; prefetch bounds concurrency; graceful worker shutdown.

## Architecture

```
publisher (API/relay) ─publish('order.events','order.created', payload, {messageId, persistent})─▶
  exchange order.events (topic)
     └─bind 'order.created'─▶ queue order.created.email  ──(nack no-requeue / reject)──▶
            x-dead-letter-exchange: order.events.dlx ──▶ queue order.created.email.dlq
  worker.consume(order.created.email, prefetch=10):
     idempotency guard (processed_messages) → mail-adapter.send → ack
```

## Related Code Files

**Create:**

- `src/infra/mq/connection.ts` (singleton conn + reconnect + `isMqHealthy()` + `closeMq()`)
- `src/infra/mq/topology.ts` (assertExchange/Queue/bindings + DLX/DLQ)
- `src/infra/mq/publisher.ts` (confirm channel publish)
- `src/infra/mq/consumer.ts` (generic consume helper w/ ack/nack/backoff)
- `src/infra/mail/mailer.ts` (Nodemailer transport singleton)
- `src/infra/mail/mail-adapter.ts` (Adapter: `sendOrderCreatedEmail(payload)`)
- `src/modules/orders/order-created-handler.ts` (business handler: idempotency + send)
- `src/workers/email-worker.ts` (entrypoint: connect, topology, consume, graceful shutdown)
  **Modify:** `src/infra/mq/outbox-relay.ts` (inject real publisher), `src/modules/health/health-routes.ts` (real `isMqHealthy()` in `/ready`), `src/app.ts`/`server.ts` (publisher init for relay).

## Implementation Steps

1. **connection.ts** singleton + reconnect:
   ```ts
   let conn, channelReady;
   export async function getConnection() {
     if (conn) return conn;
     conn = await amqp.connect(process.env.RABBITMQ_URL);
     conn.on('error', (e) => log.error(e));
     conn.on('close', () => {
       conn = null;
       setTimeout(getConnection, 2000);
     }); // reconnect backoff
     return conn;
   }
   export function isMqHealthy() {
     return !!conn;
   }
   export async function closeMq() {
     if (conn) await conn.close();
   }
   ```
2. **topology.ts**:
   ```ts
   export async function assertTopology(ch) {
     await ch.assertExchange('order.events', 'topic', { durable: true });
     await ch.assertExchange('order.events.dlx', 'topic', { durable: true });
     await ch.assertQueue('order.created.email', {
       durable: true,
       deadLetterExchange: 'order.events.dlx',
       deadLetterRoutingKey: 'order.created.dead',
     });
     await ch.bindQueue('order.created.email', 'order.events', 'order.created');
     await ch.assertQueue('order.created.email.dlq', { durable: true });
     await ch.bindQueue('order.created.email.dlq', 'order.events.dlx', 'order.created.dead');
   }
   ```
3. **publisher.ts** (confirm channel):
   ```ts
   const ch = await conn.createConfirmChannel();
   await assertTopology(ch);
   export async function publish(exchange, routingKey, payload, opts) {
     return new Promise((res, rej) => {
       ch.publish(
         exchange,
         routingKey,
         Buffer.from(JSON.stringify(payload)),
         { persistent: true, messageId: opts.messageId, contentType: 'application/json' },
         (err) => (err ? rej(err) : res()),
       ); // confirm ack
     });
   }
   ```
   Relay (phase 06) awaits this → only marks outbox `published_at` after broker confirms.
4. **mail-adapter.ts** (Adapter pattern wraps Nodemailer):
   ```ts
   const transport = nodemailer.createTransport({
     host: SMTP_HOST,
     port: SMTP_PORT,
     secure: false,
   });
   export const mailAdapter = {
     async sendOrderCreatedEmail(p) {
       await transport.sendMail({
         from: MAIL_FROM,
         to: p.email,
         subject: `Order ${p.orderId} received`,
         text: `Hi! Your order for ${p.quantity}x ${p.product} is confirmed.`,
       });
     },
   };
   ```
5. **order-created-handler.ts** (idempotent business logic):
   ```ts
   export async function handleOrderCreated(msg, { db, mailAdapter, log }) {
     const payload = JSON.parse(msg.content.toString());
     const messageId = msg.properties.messageId;
     try {
       await db.transaction(async (tx) => {
         try {
           await tx.insert(processedMessages).values({ messageId }); // dedupe guard
         } catch (e) {
           if (isUniqueViolation(e)) {
             log.info({ messageId }, 'duplicate, skip');
             return;
           }
           throw e;
         }
         await mailAdapter.sendOrderCreatedEmail(payload); // side-effect inside tx scope
       }); // commit only if both succeed
       return 'ack';
     } catch (e) {
       log.error(e, 'handler failed');
       return 'retry';
     }
   }
   ```
6. **consumer.ts** generic w/ retry+backoff+DLQ:
   ```ts
   export async function startConsumer(ch, queue, handler, { maxAttempts = 3 }) {
     await ch.prefetch(10);
     ch.consume(
       queue,
       async (msg) => {
         if (!msg) return;
         const attempts = (msg.properties.headers?.['x-attempts'] ?? 0) + 1;
         const result = await handler(msg);
         if (result === 'ack') return ch.ack(msg);
         if (attempts >= maxAttempts) return ch.nack(msg, false, false); // → DLX/DLQ
         await delay(2 ** attempts * 100); // exponential backoff
         // republish with incremented attempts then ack original (simple retry)
         ch.publish('order.events', 'order.created', msg.content, {
           ...msg.properties,
           headers: { 'x-attempts': attempts },
         });
         ch.ack(msg);
       },
       { noAck: false },
     );
   }
   ```
   Note: comment the cleaner alternative = dedicated TTL retry queue dead-lettering back to main queue (no in-process delay).
7. **email-worker.ts** entrypoint:
   ```ts
   const conn = await getConnection();
   const ch = await conn.createChannel();
   await assertTopology(ch);
   await startConsumer(ch, 'order.created.email', (m) => handleOrderCreated(m, deps), {
     maxAttempts: 3,
   });
   for (const sig of ['SIGTERM', 'SIGINT'])
     process.on(sig, async () => {
       await ch.close();
       await closeMq();
       await closePool();
       process.exit(0);
     });
   ```
8. Wire `isMqHealthy()` into `/ready` (phase 04 stub → real). Init publisher in API before relay starts.

## Todo

- [ ] connection.ts singleton + reconnect + isMqHealthy + closeMq
- [ ] topology.ts (exchange, queue, DLX, DLQ, bindings)
- [ ] publisher.ts confirm-channel publish (relay awaits confirm)
- [ ] mailer + mail-adapter (Nodemailer → Mailpit)
- [ ] order-created-handler idempotent (processed_messages guard)
- [ ] consumer.ts prefetch + retry/backoff + nack→DLQ
- [ ] email-worker.ts entrypoint + graceful shutdown
- [ ] wire real /ready mq check; init publisher for relay
- [ ] e2e manual: POST /orders → Mailpit shows email; duplicate → one email; force-fail → DLQ

## Success Criteria

- Order → relay publish (confirmed) → worker → email in Mailpit UI (:8025).
- Re-deliver same messageId → exactly one email (processed_messages dedupe).
- Handler always failing → message reaches DLQ after maxAttempts, no infinite loop.
- Broker restart → connection auto-reconnects.

## Risk Assessment

- amqplib v0.10 returns Promise API (no callback hell) — ensure async/await everywhere.
- In-process retry republish loses ordering / can duplicate — acceptable (idempotent). Document TTL-queue as production upgrade.
- Email send inside DB tx holds tx open during SMTP — fine for Mailpit/dev; in prod move send outside tx with outbox-on-consumer or status flag (note YAGNI now).

## Security Considerations

- Messages `persistent: true` + durable queues survive broker restart.
- No secrets in payload beyond dev email. SMTP creds via env (Mailpit none in dev).

## Next Steps

Phase 08 adds OTel so the trace spans API publish → worker consume (context via amqplib headers).
