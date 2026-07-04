export * from './keys.js';

// --- Redis cache keys + TTLs (seconds) --------------------------------------
/** Public product catalog — active-product list. */
export const CATALOG_LIST_KEY = 'catalog:list';
/** Catalog cache staleness bound — correctness is invalidate-on-write; the TTL is the safety net. */
export const CATALOG_TTL_SECONDS = 300;
/** Payment webhook fast-path dedup retention. */
export const WEBHOOK_DEDUP_TTL_SECONDS = 60 * 60 * 24; // 24h

// --- HTTP Idempotency-Key plugin -------------------------------------------
export const IDEMPOTENCY_HEADER = 'idempotency-key';
/** Sentinel stored while the owning request is in flight — retries that hit it get 409, not a replay. */
export const PROCESSING_MARKER = '__processing__';
/** Short marker TTL: a crash between claim and persist blocks retries only briefly. */
export const PROCESSING_TTL_SECONDS = 30;
/** Replay window for a completed 2xx response. */
export const DONE_TTL_SECONDS = 60 * 60 * 24; // 24h

// --- processed_messages consumer-name dimensions ----------------------------
// Each consumer dedups its own copy of an event (exactly-once per consumer), so the same logical
// event can be processed once by several independent consumers. Persisted in the dedup table —
// do NOT change a value once it is in use.
export const INVENTORY_CONSUMER = 'inventory';
export const PAYMENT_CREATE_CONSUMER = 'payment-create';
export const PAYMENT_COMPLETE_CONSUMER = 'payment-complete';
export const PAYMENT_COMPENSATE_CONSUMER = 'payment-compensate';
export const SHIPPING_CONSUMER = 'shipping';
export const MOCK_PROVIDER_CONSUMER = 'mock-provider';
export const NOTIFY_CONSUMER = 'notify';
export const WEBHOOK_CONSUMER = 'webhook';
