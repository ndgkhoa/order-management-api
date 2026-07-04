# Event Flow

The happy path from checkout to delivery, as a chain of outbox events. Every event carries a
`correlationId = orderId` and a stable `eventId`; consumers dedupe on `eventId` and each emits
the next event in the **same transaction** as the state change.

## Event graph (happy path)

```mermaid
flowchart TD
  A[POST /orders] -->|order.created| B[inventory: reserve stock]
  A -.->|order.created| M0[email: order confirmation]
  B -->|inventory.reserved| C[create pending payment]
  C -->|payment.created| D[mock provider: schedule webhook]
  D -->|POST /webhooks/payment<br/>HMAC-signed| E[payment: verify + settle]
  E -->|payment.succeeded| F[order → paid, commit reservation]
  F -->|order.paid| G[shipping: create shipment]
  G -->|shipment.created| H[fake carrier: timed advances]
  H -->|shipment.ready_for_pickup| H
  H -->|shipment.in_transit| H
  H -->|shipment.delivered| I[order → delivered]

  F -.->|order.paid| N1[notify: paid]
  H -.->|shipment.in_transit| N2[notify: shipped]
  H -.->|shipment.delivered| N3[notify: delivered · email+sms]
```

Solid arrows = state-advancing saga steps. Dashed arrows = fan-out notifications (the same
event is consumed independently by the notifications consumer; a topic exchange delivers a copy
to every bound queue).

## Sequence (place → deliver)

```mermaid
sequenceDiagram
  autonumber
  participant C as Client
  participant API as Fastify API
  participant DB as Postgres
  participant MQ as RabbitMQ
  participant W as Worker
  participant P as Mock provider

  C->>API: POST /orders (JWT)
  API->>DB: tx: order(pending) + items + outbox(order.created)
  API-->>C: 201 pending
  Note over API,MQ: relay publishes order.created
  MQ->>W: order.created
  W->>DB: tx: reserve stock + outbox(inventory.reserved)
  MQ->>W: inventory.reserved
  W->>DB: tx: payment(pending) + outbox(payment.created)
  MQ->>P: payment.created
  P->>API: POST /webhooks/payment (HMAC, after delay)
  API->>DB: tx: payment→paid + outbox(payment.succeeded)
  API-->>P: 200
  MQ->>W: payment.succeeded
  W->>DB: tx: order→paid + commit reserve + outbox(order.paid)
  MQ->>W: order.paid
  W->>DB: tx: shipment(pending) + order→fulfilling + outbox(shipment.created)
  loop every SHIPPING_STEP_MS
    W->>DB: tx: advance shipment + outbox(shipment.*)
  end
  Note over W,DB: on delivered → order→delivered
```

## Events

| Event                                                                | Emitted by                                                    | Consumed by                               |
| -------------------------------------------------------------------- | ------------------------------------------------------------- | ----------------------------------------- |
| `order.created`                                                      | POST /orders (API)                                            | inventory, email                          |
| `inventory.reserved`                                                 | inventory consumer                                            | payment-create                            |
| `payment.created`                                                    | payment-create                                                | mock provider                             |
| `payment.succeeded` / `payment.failed`                               | payment webhook (API)                                         | payment-complete / payment-compensate     |
| `order.paid`                                                         | payment-complete                                              | shipping, notifications                   |
| `shipment.created` / `ready_for_pickup` / `in_transit` / `delivered` | shipping                                                      | notifications (`in_transit`, `delivered`) |
| `order.cancelled`                                                    | inventory (out-of-stock), payment-compensate, cancel endpoint | notifications                             |
| `order.refunded`                                                     | cancel endpoint (paid order)                                  | notifications                             |

See [compensation.md](./compensation.md) for the failure branches.
