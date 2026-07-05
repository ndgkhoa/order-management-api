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
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { UserRoles } from '@/types/user-role';
import { OrderStatuses } from '@/types/order-status';
import { PaymentStatuses } from '@/types/payment-status';
import { ShipmentStatuses } from '@/types/shipment-status';
import { DEFAULT_CURRENCY } from '@/types/currency';

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  roles: text('roles').array().notNull().default([UserRoles.Customer]),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

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

export const orders = pgTable(
  'orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    status: text('status').notNull().default(OrderStatuses.Pending),
    totalCents: integer('total_cents').notNull(),
    currency: text('currency').notNull().default(DEFAULT_CURRENCY),
    cancelReason: text('cancel_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('orders_user_id_idx').on(t.userId)],
);

export const orderItems = pgTable(
  'order_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id),
    skuSnapshot: text('sku_snapshot').notNull(),
    unitPriceCents: integer('unit_price_cents').notNull(),
    quantity: integer('quantity').notNull(),
    lineTotalCents: integer('line_total_cents').notNull(),
  },
  (t) => [
    index('order_items_order_id_idx').on(t.orderId),
    index('order_items_product_id_idx').on(t.productId),
  ],
);

export const payments = pgTable(
  'payments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id),
    amountCents: integer('amount_cents').notNull(),
    currency: text('currency').notNull().default(DEFAULT_CURRENCY),
    status: text('status').notNull().default(PaymentStatuses.Pending),
    providerEventId: uuid('provider_event_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('payments_order_id_uq').on(t.orderId)],
);

export const shipments = pgTable(
  'shipments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id),
    status: text('status').notNull().default(ShipmentStatuses.Pending),
    carrier: text('carrier').notNull().default('MockPost'),
    trackingNo: text('tracking_no'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('shipments_order_id_uq').on(t.orderId)],
);

export const orderStatusHistory = pgTable(
  'order_status_history',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id),
    fromStatus: text('from_status'),
    toStatus: text('to_status').notNull(),
    reason: text('reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('order_status_history_order_id_idx').on(t.orderId)],
);

export const outboxMessages = pgTable(
  'outbox_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventId: uuid('event_id').notNull().defaultRandom(),
    correlationId: text('correlation_id'),
    aggregateType: text('aggregate_type').notNull(),
    aggregateId: uuid('aggregate_id').notNull(),
    eventType: text('event_type').notNull(),
    payload: jsonb('payload').notNull(),
    traceContext: jsonb('trace_context').$type<Record<string, string>>(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('outbox_unpublished_idx').on(t.publishedAt)],
);

export const processedMessages = pgTable(
  'processed_messages',
  {
    consumerName: text('consumer_name').notNull(),
    eventId: uuid('event_id').notNull(),
    processedAt: timestamp('processed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.consumerName, t.eventId] })],
);
