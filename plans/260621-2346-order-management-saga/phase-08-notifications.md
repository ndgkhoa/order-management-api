---
phase: 8
title: 'Notifications'
status: pending
priority: P2
effort: '4h'
dependencies: [6]
---

# Phase 8: Notifications

## Overview

Generalize the email worker into a channel-agnostic notification system: a `NotificationProvider` interface with a real `EmailProvider` and a stubbed `SmsProvider` (TODO). A notification consumer routes saga events to templated messages.

## Requirements

- Functional: consume notification-worthy events (`OrderCreated`? no — user-facing: `OrderPaid`, `OrderCancelled`/out_of_stock, `ShipmentInTransit`, `ShipmentDelivered`, `OrderRefunded`) → render template → dispatch via provider(s). Email fully works (Mailpit); SMS provider is a stub logging "TODO".
- Non-functional: idempotent (dedup on eventId — don't double-send on redelivery); provider selection by event type/config; templates separated from transport.

## Architecture

- `src/infra/notify/notification-provider.ts` — interface `{ channel, send(to, message) }`.
- `src/infra/notify/email-provider.ts` — wraps existing Nodemailer mailer (reuse `src/infra/mail/`).
- `src/infra/notify/sms-provider.ts` — stub: logs intent, marked TODO (no real transport).
- `src/modules/notifications/notification-handler.ts` — consumer; maps eventType → `{ channels, template }`; renders + dispatches; dedup via processed_messages.
- Templates: `src/modules/notifications/templates/` (one renderer per event; keep small). Replaces the inline email in `order-created-handler` where appropriate (or coexists — keep order.created email if desired).

## Related Code Files

- Create: `src/infra/notify/{notification-provider,email-provider,sms-provider}.ts`, `src/modules/notifications/notification-handler.ts`, `src/modules/notifications/templates/*.ts`
- Modify: `src/workers/email-worker.ts` (route via notification-handler) or add a notifications worker; `src/infra/mq/topology.ts` (bind notification consumer to relevant routing keys)

## TDD — Tests First

1. `test/unit/notification-routing.test.ts` — eventType → correct channels + template; unknown event → no-op.
2. `test/unit/email-provider.test.ts` — renders + calls mailer with expected to/subject/body.
3. `test/integration/notification-dedup.test.ts` — same eventId twice → one email sent (Mailpit/captured transport).
4. `test/unit/sms-provider.test.ts` — stub logs TODO, does not throw.

## Implementation Steps

1. Write failing tests.
2. Implement provider interface + email provider (reuse mailer) + sms stub.
3. Implement notification handler (event→template→dispatch) with dedup.
4. Wire consumer bindings for paid/cancelled/shipped/delivered/refunded.
5. typecheck + lint + tests green.

## Success Criteria

- [ ] `NotificationProvider` interface; `EmailProvider` sends real emails (Mailpit), `SmsProvider` stubbed TODO.
- [ ] Saga events route to correct templated notifications.
- [ ] Redelivery → single send (idempotent).
- [ ] typecheck + lint + tests green.

## Risk Assessment

- Scope creep into real SMS → keep SMS a stub (YAGNI), only the abstraction is multi-channel.
- Double-send on redelivery → dedup on eventId before dispatch.
- Don't duplicate mailer logic → EmailProvider wraps existing `src/infra/mail/`.
