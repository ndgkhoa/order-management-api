import { Counter } from 'prom-client';

/**
 * Prometheus counters for saga milestones, registered on the default registry so they surface
 * at the API's `/metrics` endpoint. Milestones that occur in the API process (order create,
 * payment webhook, cancel/refund) are scraped directly; milestones handled by the background
 * worker (inventory reserve, shipment delivery) increment the worker process's own registry —
 * to scrape those, expose `/metrics` on the worker too.
 */
export const sagaMetrics = {
  ordersCreated: new Counter({
    name: 'saga_orders_created_total',
    help: 'Orders created',
  }),
  inventoryReserved: new Counter({
    name: 'saga_inventory_reserved_total',
    help: 'Orders whose stock was reserved',
  }),
  paymentsSucceeded: new Counter({
    name: 'saga_payments_succeeded_total',
    help: 'Payments that succeeded',
  }),
  paymentsFailed: new Counter({
    name: 'saga_payments_failed_total',
    help: 'Payments that failed',
  }),
  ordersCancelled: new Counter({
    name: 'saga_orders_cancelled_total',
    help: 'Orders cancelled (out of stock, payment failed, or customer cancel)',
  }),
  shipmentsDelivered: new Counter({
    name: 'saga_shipments_delivered_total',
    help: 'Shipments delivered',
  }),
  /**
   * Saga invariant/guard anomalies that "should never happen" (e.g. a stock guard failing while
   * committing/releasing a reservation). Normally flat at 0 — a rising `type` indicates state
   * drift worth investigating, so it can be alerted on instead of being buried in warn logs.
   */
  anomalies: new Counter({
    name: 'saga_anomalies_total',
    help: 'Saga guard/invariant anomalies detected',
    labelNames: ['type'] as const,
  }),
};
