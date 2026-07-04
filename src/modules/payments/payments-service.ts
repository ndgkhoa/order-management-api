import type { PaymentsRepository } from '@modules/payments/payments-repository.js';
import type { SettleInput, SettleResult } from '@modules/payments/payments-schema.js';

interface PaymentsServiceDeps {
  paymentsRepo: PaymentsRepository;
}

/**
 * Payments orchestration. All DB/transaction work lives in the repository; this layer
 * is a thin pass-through so that future cross-repo coordination can be added here
 * without touching the controller.
 */
export function makePaymentsService({ paymentsRepo }: PaymentsServiceDeps) {
  return {
    async settle(input: SettleInput): Promise<SettleResult> {
      return paymentsRepo.settle(input);
    },
  };
}

export type PaymentsService = ReturnType<typeof makePaymentsService>;
