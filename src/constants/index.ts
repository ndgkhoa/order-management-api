export * from './keys';

export const CATALOG_LIST_KEY = 'catalog:list';
export const CATALOG_TTL_SECONDS = 300;
export const WEBHOOK_DEDUP_TTL_SECONDS = 60 * 60 * 24;

export const IDEMPOTENCY_HEADER = 'idempotency-key';
export const PROCESSING_MARKER = '__processing__';
export const PROCESSING_TTL_SECONDS = 30;
export const DONE_TTL_SECONDS = 60 * 60 * 24;

// Persisted in the dedup table — do NOT change a value once it is in use.
export const INVENTORY_CONSUMER = 'inventory';
export const PAYMENT_CREATE_CONSUMER = 'payment-create';
export const PAYMENT_COMPLETE_CONSUMER = 'payment-complete';
export const PAYMENT_COMPENSATE_CONSUMER = 'payment-compensate';
export const SHIPPING_CONSUMER = 'shipping';
export const MOCK_PROVIDER_CONSUMER = 'mock-provider';
export const NOTIFY_CONSUMER = 'notify';
export const WEBHOOK_CONSUMER = 'webhook';
