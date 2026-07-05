import { Counter } from 'prom-client';

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
  anomalies: new Counter({
    name: 'saga_anomalies_total',
    help: 'Saga guard/invariant anomalies detected',
    labelNames: ['type'] as const,
  }),
};
