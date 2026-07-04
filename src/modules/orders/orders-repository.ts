import { and, desc, eq, lt } from 'drizzle-orm';
import { context, propagation } from '@opentelemetry/api';
import type { DB, Tx } from '@infra/db/client.js';
import {
  orders,
  orderItems,
  orderStatusHistory,
  outboxMessages,
  payments,
} from '@infra/db/schema.js';
import {
  ORDER_CREATED_EVENT,
  ORDER_CANCELLED_EVENT,
  ORDER_REFUNDED_EVENT,
  type OrderCreatedPayload,
  type OrderCancelledPayload,
  type OrderRefundedPayload,
} from '@infra/mq/outbox-event-types.js';
import type { CreateOrderInput, CancelOrderInput } from '@modules/orders/orders-schema.js';
import { makeInventoryRepository } from '@modules/inventory/inventory-repository.js';
import { type OrderStatus, OrderStatuses, ORDER_TRANSITIONS } from '@/types/order-status.js';
import { assertTransition } from '@/utils/state-machine.js';
import { PaymentStatuses } from '@/types/payment-status.js';
import { OrderReasons } from '@/types/order-reasons.js';
import { sagaMetrics } from '@infra/telemetry/saga-metrics.js';

/** Data access for orders. The create path is the Transactional Outbox core; cancel is the
 *  cross-aggregate compensation transaction (orders + payment + stock + outbox) rooted here.
 *  Methods call each other via `this`, so always invoke them as `repository.method(...)`. */
export function makeOrdersRepository(db: DB) {
  const inventoryRepo = makeInventoryRepository();
  return {
    /** Appends one order status-transition audit row inside the caller's transaction. */
    async recordTransition(
      tx: Tx,
      input: { orderId: string; from: OrderStatus | null; to: OrderStatus; reason?: string },
    ): Promise<void> {
      await tx.insert(orderStatusHistory).values({
        orderId: input.orderId,
        fromStatus: input.from,
        toStatus: input.to,
        reason: input.reason ?? null,
      });
    },

    /**
     * Guarded order status transition. Asserts the move is legal, applies it with a CAS UPDATE
     * (only while the row is still `from`), and on success appends the audit history row — all on
     * the caller's transaction. Returns `true` if a row transitioned, `false` if the CAS matched
     * nothing (lost race / already terminal / duplicate delivery).
     */
    async transition(
      tx: Tx,
      orderId: string,
      from: OrderStatus,
      to: OrderStatus,
      opts: { reason: string; cancelReason?: string },
    ): Promise<boolean> {
      assertTransition(ORDER_TRANSITIONS, from, to);
      const rows = await tx
        .update(orders)
        .set({
          status: to,
          updatedAt: new Date(),
          ...(opts.cancelReason !== undefined ? { cancelReason: opts.cancelReason } : {}),
        })
        .where(and(eq(orders.id, orderId), eq(orders.status, from)))
        .returning({ id: orders.id });
      if (rows.length === 0) return false;
      await this.recordTransition(tx, { orderId, from, to, reason: opts.reason });
      return true;
    },

    /**
     * Writes the order header, its line items, AND the `order.created` outbox row in ONE
     * transaction — all commit together or none does, so the event can never be lost or
     * orphaned. NO stock reservation and NO payment here; those are async saga steps.
     */
    async createWithOutbox(input: CreateOrderInput) {
      const result = await db.transaction(async (tx) => {
        const orderRows = await tx
          .insert(orders)
          .values({ userId: input.userId, totalCents: input.totalCents })
          .returning();
        const order = orderRows[0];
        if (!order) throw new Error('order insert returned no row');

        const itemRows = await tx
          .insert(orderItems)
          .values(input.lines.map((line) => ({ orderId: order.id, ...line })))
          .returning();

        const payload: OrderCreatedPayload = {
          orderId: order.id,
          userId: order.userId,
          items: input.lines.map((line) => ({
            productId: line.productId,
            sku: line.skuSnapshot,
            unitPriceCents: line.unitPriceCents,
            quantity: line.quantity,
          })),
          totalCents: order.totalCents,
        };
        // Capture the active (request) trace context into a W3C carrier so the relay can
        // resume THIS trace at publish time — without it the relay's later publish starts
        // a brand-new trace, splitting the request and the worker apart.
        const carrier: Record<string, string> = {};
        propagation.inject(context.active(), carrier);

        await tx.insert(outboxMessages).values({
          aggregateType: 'order',
          aggregateId: order.id,
          correlationId: order.id, // saga correlation = order id; event_id defaults to a fresh uuid
          eventType: ORDER_CREATED_EVENT,
          payload,
          traceContext: Object.keys(carrier).length > 0 ? carrier : null,
        });

        await this.recordTransition(tx, {
          orderId: order.id,
          from: null,
          to: OrderStatuses.Pending,
          reason: OrderReasons.Created,
        });

        return { order, items: itemRows };
      });
      sagaMetrics.ordersCreated.inc();
      return result;
    },

    /**
     * Cancel an order (owner or `order:cancel:any`) — the cross-aggregate compensation, CAS-first
     * so it races safely against the shipping worker:
     *  - `paid`    → refund (payment paid→refunded) + restock + `order.refunded`
     *  - `pending` → release the reservation + `order.cancelled`
     *  - otherwise → `conflict` (the order can no longer be cancelled).
     * Ownership scoping is the IDOR guard: `not_found` is returned for a missing OR unowned order.
     */
    async cancel(input: CancelOrderInput): Promise<
      | { outcome: 'not_found' }
      | { outcome: 'conflict' }
      | {
          outcome: 'cancelled';
          order: typeof orders.$inferSelect;
          items: (typeof orderItems.$inferSelect)[];
        }
    > {
      const owned = await db.query.orders.findFirst({
        where: input.canCancelAny
          ? eq(orders.id, input.orderId)
          : and(eq(orders.id, input.orderId), eq(orders.userId, input.requesterId)),
      });
      if (!owned) return { outcome: 'not_found' };

      let conflict = false;
      await db.transaction(async (tx) => {
        const items = await tx
          .select({ productId: orderItems.productId, quantity: orderItems.quantity })
          .from(orderItems)
          .where(eq(orderItems.orderId, input.orderId));

        // paid → refund + restock
        const didRefund = await this.transition(
          tx,
          input.orderId,
          OrderStatuses.Paid,
          OrderStatuses.Cancelled,
          { reason: OrderReasons.Refund, cancelReason: OrderReasons.CustomerCancelled },
        );
        if (didRefund) {
          for (const item of items) await inventoryRepo.restock(tx, item.productId, item.quantity);
          const [refunded] = await tx
            .update(payments)
            .set({ status: PaymentStatuses.Refunded, updatedAt: new Date() })
            .where(
              and(eq(payments.orderId, input.orderId), eq(payments.status, PaymentStatuses.Paid)),
            )
            .returning({ id: payments.id });
          const payload: OrderRefundedPayload = {
            orderId: input.orderId,
            paymentId: refunded?.id ?? '',
          };
          await tx.insert(outboxMessages).values({
            aggregateType: 'order',
            aggregateId: input.orderId,
            correlationId: input.orderId,
            eventType: ORDER_REFUNDED_EVENT,
            payload,
          });
          return;
        }

        // pending → release the reservation
        const released = await this.transition(
          tx,
          input.orderId,
          OrderStatuses.Pending,
          OrderStatuses.Cancelled,
          { reason: OrderReasons.CustomerCancelled, cancelReason: OrderReasons.CustomerCancelled },
        );
        if (released) {
          for (const item of items) await inventoryRepo.release(tx, item.productId, item.quantity);
          const payload: OrderCancelledPayload = {
            orderId: input.orderId,
            reason: OrderReasons.CustomerCancelled,
          };
          await tx.insert(outboxMessages).values({
            aggregateType: 'order',
            aggregateId: input.orderId,
            correlationId: input.orderId,
            eventType: ORDER_CANCELLED_EVENT,
            payload,
          });
          return;
        }

        conflict = true; // already fulfilling/delivered/cancelled
      });
      if (conflict) return { outcome: 'conflict' };

      const order = await db.query.orders.findFirst({ where: eq(orders.id, input.orderId) });
      const items = await db.query.orderItems.findMany({
        where: eq(orderItems.orderId, input.orderId),
      });
      return { outcome: 'cancelled', order: order!, items };
    },

    async listByUser(userId: string) {
      return db.query.orders.findMany({
        where: eq(orders.userId, userId),
        orderBy: desc(orders.createdAt),
      });
    },

    /** Admin: every order, newest first. */
    async listAll() {
      return db.query.orders.findMany({ orderBy: desc(orders.createdAt) });
    },

    /** Owner-scoped fetch (order + items). Returns undefined if missing or not owned. */
    async findByIdForUser(orderId: string, userId: string) {
      const order = await db.query.orders.findFirst({
        where: and(eq(orders.id, orderId), eq(orders.userId, userId)),
      });
      if (!order) return undefined;
      const items = await db.query.orderItems.findMany({
        where: eq(orderItems.orderId, orderId),
      });
      return { order, items };
    },

    /** Orders stuck in `pending` since before `cutoff` (for the reaper). */
    async findStuckOrders(cutoff: Date) {
      return db
        .select({ id: orders.id, createdAt: orders.createdAt })
        .from(orders)
        .where(and(eq(orders.status, OrderStatuses.Pending), lt(orders.createdAt, cutoff)));
    },
  };
}

export type OrdersRepository = ReturnType<typeof makeOrdersRepository>;
