import { Type, type Static } from '@sinclair/typebox';

/** Signed webhook body from the (mock) payment provider. `timestamp` is epoch ms. */
export const WebhookBody = Type.Object({
  providerEventId: Type.String({ format: 'uuid' }),
  paymentId: Type.String({ format: 'uuid' }),
  outcome: Type.Union([Type.Literal('SUCCEEDED'), Type.Literal('FAILED')]),
  timestamp: Type.Number(),
});
export type WebhookBody = Static<typeof WebhookBody>;

/** Ack returned to the provider (200) — reports whether the event was applied/deduped. */
export const WebhookAck = Type.Object({ status: Type.String() });

/** Path params for the admin force-outcome endpoints. */
export const PaymentIdParams = Type.Object({ id: Type.String({ format: 'uuid' }) });

export const MockAck = Type.Object({ status: Type.String(), paymentId: Type.String() });
