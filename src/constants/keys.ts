export const catalogItemKey = (id: string) => `catalog:item:${id}`;

export const webhookDedupKey = (providerEventId: string) => `processed:webhook:${providerEventId}`;
