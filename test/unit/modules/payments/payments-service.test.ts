import { describe, it, expect } from 'vitest';
import { makePaymentsService } from '@modules/payments/payments-service.js';
import type { PaymentsRepository } from '@modules/payments/payments-repository.js';
import type { SettleInput, SettleResult } from '@modules/payments/payments-schema.js';

function makeStubRepo(result: SettleResult) {
  const calls: SettleInput[] = [];
  const paymentsRepo = {
    settle(input: SettleInput): Promise<SettleResult> {
      calls.push(input);
      return Promise.resolve(result);
    },
  } as unknown as PaymentsRepository;
  return { paymentsRepo, calls };
}

const input: SettleInput = {
  paymentId: 'pay-1',
  providerEventId: 'evt-1',
  outcome: 'SUCCEEDED',
};

describe('paymentsService.settle', () => {
  it('forwards the settle input verbatim to the repository', async () => {
    const { paymentsRepo, calls } = makeStubRepo('applied');
    const service = makePaymentsService({ paymentsRepo });

    await service.settle(input);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual(input);
  });

  it.each(['applied', 'duplicate', 'noop'] as const)(
    'returns the repository result unchanged (%s)',
    async (result) => {
      const { paymentsRepo } = makeStubRepo(result);
      const service = makePaymentsService({ paymentsRepo });

      await expect(service.settle(input)).resolves.toBe(result);
    },
  );
});
