import { describe, it, expect } from 'vitest';
import { sagaMetrics } from '@infra/telemetry/saga-metrics';
import { counterValue } from '@test/helpers/metric-value';

describe('sagaMetrics', () => {
  it('exposes and increments a counter per saga milestone', async () => {
    const cases: [() => void, string][] = [
      [() => sagaMetrics.ordersCreated.inc(), 'saga_orders_created_total'],
      [() => sagaMetrics.inventoryReserved.inc(), 'saga_inventory_reserved_total'],
      [() => sagaMetrics.paymentsSucceeded.inc(), 'saga_payments_succeeded_total'],
      [() => sagaMetrics.paymentsFailed.inc(), 'saga_payments_failed_total'],
      [() => sagaMetrics.ordersCancelled.inc(), 'saga_orders_cancelled_total'],
      [() => sagaMetrics.shipmentsDelivered.inc(), 'saga_shipments_delivered_total'],
    ];

    for (const [inc, name] of cases) {
      const before = await counterValue(name);
      inc();
      expect(await counterValue(name)).toBe(before + 1);
    }
  });
});
