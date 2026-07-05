import { Type, type Static } from '@sinclair/typebox';

export const WebhookBody = Type.Object({
  providerEventId: Type.String({ format: 'uuid' }),
  paymentId: Type.String({ format: 'uuid' }),
  outcome: Type.Union([Type.Literal('SUCCEEDED'), Type.Literal('FAILED')]),
  timestamp: Type.Number(),
});
export type WebhookBody = Static<typeof WebhookBody>;

export const PaymentIdParams = Type.Object({ id: Type.String({ format: 'uuid' }) });

export const WebhookAck = Type.Object({ status: Type.String() });

export const MockAck = Type.Object({ status: Type.String(), paymentId: Type.String() });

export type SettleOutcome = 'SUCCEEDED' | 'FAILED';
export type SettleResult = 'applied' | 'duplicate' | 'noop';

export type SettleInput = {
  paymentId: string;
  providerEventId: string;
  outcome: SettleOutcome;
};
