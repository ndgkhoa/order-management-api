import type { PaymentsRepository } from '@modules/payments/payments-repository';
import type { SettleInput, SettleResult } from '@modules/payments/payments-schema';

interface PaymentsServiceDeps {
  paymentsRepo: PaymentsRepository;
}

export function makePaymentsService({ paymentsRepo }: PaymentsServiceDeps) {
  return {
    async settle(input: SettleInput): Promise<SettleResult> {
      return paymentsRepo.settle(input);
    },
  };
}

export type PaymentsService = ReturnType<typeof makePaymentsService>;
