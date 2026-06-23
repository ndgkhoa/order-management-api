import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  boolean,
  jsonb,
  index,
  primaryKey,
  check,
  pgEnum,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { USER_ROLES, UserRoles } from '@/types/user-role.js';

/** DB enum bound to the role values defined in `@/types/user-role` (single source of truth). */
export const userRole = pgEnum('user_role', USER_ROLES);

/** Application users. Only the argon2 hash is stored — never the plaintext password.
 *  `role` drives RBAC (`requireRole`); JWTs carry it so guards read it from the token. */
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: userRole('role').notNull().default(UserRoles.Customer),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Product catalog. `price_cents` is integer cents (no float money). Stock is split into
 * `available` (sellable) and `reserved` (held by in-flight orders); the reserve/release
 * logic lands in later phases — here the columns exist with non-negative CHECK guards.
 * `active=false` is a soft delete so orders can still reference a withdrawn product.
 */
export const products = pgTable(
  'products',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sku: text('sku').notNull().unique(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    priceCents: integer('price_cents').notNull(),
    stockAvailable: integer('stock_available').notNull().default(0),
    stockReserved: integer('stock_reserved').notNull().default(0),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('products_stock_available_nonneg', sql`${t.stockAvailable} >= 0`),
    check('products_stock_reserved_nonneg', sql`${t.stockReserved} >= 0`),
  ],
);

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
    // Logical event id — stable across re-emits, distinct from the row `id`. The relay
    // publishes it in the envelope; consumers dedupe on it. Defaulted so existing rows
    // and inserts that omit it still get a value.
    eventId: uuid('event_id').notNull().defaultRandom(),
    // Ties every event in a saga to its aggregate (= order id) for tracing/correlation.
    correlationId: text('correlation_id'),
    aggregateType: text('aggregate_type').notNull(), // e.g. 'order'
    aggregateId: uuid('aggregate_id').notNull(),
    eventType: text('event_type').notNull(), // e.g. 'order.created'
    payload: jsonb('payload').notNull(),
    // W3C trace context (traceparent/tracestate) captured at write time inside the
    // request span, so the relay can resume that trace when it publishes later.
    // Null when OTel is disabled or for rows written before this column existed.
    traceContext: jsonb('trace_context').$type<Record<string, string>>(),
    publishedAt: timestamp('published_at', { withTimezone: true }), // null = unsent
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('outbox_unpublished_idx').on(t.publishedAt)],
);

/**
 * Idempotent Consumer guard, keyed per consumer. Each consumer inserts
 * (`consumerName`, `eventId`) inside its handler transaction; a duplicate delivery
 * hits the composite PK conflict → skip. The consumer dimension lets independent
 * consumers (email, inventory, …) each process the SAME logical event exactly once
 * without one consumer's dedupe row blocking another (fan-out safe).
 */
export const processedMessages = pgTable(
  'processed_messages',
  {
    consumerName: text('consumer_name').notNull(),
    eventId: uuid('event_id').notNull(),
    processedAt: timestamp('processed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.consumerName, t.eventId] })],
);
