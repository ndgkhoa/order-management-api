import { pgTable, uuid, text, timestamp, integer, jsonb, index } from 'drizzle-orm/pg-core';

/** Application users. Only the argon2 hash is stored — never the plaintext password. */
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Orders placed by a user. `amount` is stored in integer cents to avoid float money bugs. */
export const orders = pgTable('orders', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  product: text('product').notNull(),
  quantity: integer('quantity').notNull(),
  amount: integer('amount').notNull(), // cents
  status: text('status').notNull().default('created'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Transactional Outbox: an event row written in the SAME transaction as the order.
 * A relay later publishes unsent rows to RabbitMQ and stamps `publishedAt`.
 * `publishedAt IS NULL` = not yet published (indexed for the relay's poll query).
 */
export const outboxMessages = pgTable(
  'outbox_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    aggregateType: text('aggregate_type').notNull(), // e.g. 'order'
    aggregateId: uuid('aggregate_id').notNull(),
    eventType: text('event_type').notNull(), // e.g. 'order.created'
    payload: jsonb('payload').notNull(),
    publishedAt: timestamp('published_at', { withTimezone: true }), // null = unsent
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('outbox_unpublished_idx').on(t.publishedAt)],
);

/**
 * Idempotent Consumer guard: the worker inserts the message id here inside its
 * handler transaction. A duplicate delivery hits the PK conflict → skip (no double email).
 * `messageId` reuses the outbox row id as the dedupe key.
 */
export const processedMessages = pgTable('processed_messages', {
  messageId: uuid('message_id').primaryKey(),
  processedAt: timestamp('processed_at', { withTimezone: true }).notNull().defaultNow(),
});
