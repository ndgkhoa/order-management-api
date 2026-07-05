import { and, desc, eq, lt } from 'drizzle-orm';
import { context, propagation } from '@opentelemetry/api';
import type { DB, Tx } from '@infra/db/client';
import { orders, orderItems, orderStatusHistory, outboxMessages, payments } from '@infra/db/schema';
import {
  ORDER_CREATED_EVENT,
  ORDER_CANCELLED_EVENT,
  ORDER_REFUNDED_EVENT,
  type OrderCreatedPayload,
  type OrderCancelledPayload,
  type OrderRefundedPayload,
} from '@infra/mq/outbox-event-types';
import type { CreateOrderInput, CancelOrderInput } from '@modules/orders/orders-schema';
import { makeInventoryRepository } from '@modules/inventory/inventory-repository';
import { type OrderStatus, OrderStatuses, ORDER_TRANSITIONS } from '@/types/order-status';
import { assertTransition } from '@/utils/state-machine';
import { PaymentStatuses } from '@/types/payment-status';
import { OrderReasons } from '@/types/order-reasons';
import { sagaMetrics } from '@infra/telemetry/saga-metrics';

export function makeOrdersRepository(db: DB) {
  const inventoryRepo = makeInventoryRepository();
  return {
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
        const carrier: Record<string, string> = {};
        propagation.inject(context.active(), carrier);

        await tx.insert(outboxMessages).values({
          aggregateType: 'order',
          aggregateId: order.id,
          correlationId: order.id,
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

    // Ownership scoping is the IDOR guard: not_found for a missing OR unowned order.
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

        conflict = true;
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

    async listAll() {
      return db.query.orders.findMany({ orderBy: desc(orders.createdAt) });
    },

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

    async findStuckOrders(cutoff: Date) {
      return db
        .select({ id: orders.id, createdAt: orders.createdAt })
        .from(orders)
        .where(and(eq(orders.status, OrderStatuses.Pending), lt(orders.createdAt, cutoff)));
    },
  };
}

export type OrdersRepository = ReturnType<typeof makeOrdersRepository>;
