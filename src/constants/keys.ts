/**
 * Redis key builders (the key namespace only). Correctness of the caches/dedup that use them
 * comes from invalidate-on-write and durable backstops, not from these strings.
 */

/** Public product catalog — a single active product by id. */
export const catalogItemKey = (id: string) => `catalog:item:${id}`;

/** Payment webhook fast-path dedup by provider event id (durable backstop: WEBHOOK_CONSUMER). */
export const webhookDedupKey = (providerEventId: string) => `processed:webhook:${providerEventId}`;
