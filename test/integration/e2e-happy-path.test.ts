import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { pino } from 'pino';
import { and, desc, eq } from 'drizzle-orm';
import type { ConsumeMessage } from 'amqplib';
import type { FastifyBaseLogger } from 'fastify';
import type { AppInstance } from '@/app.js';
import { db } from '@infra/db/client.js';
import { orders, products, payments, shipments, outboxMessages } from '@infra/db/schema.js';
import { reserveOnOrderCreated } from '@modules/inventory/reserve-on-order-created.js';
import { createPaymentOnReserved } from '@modules/payments/create-payment-on-reserved.js';
import { completeOnPaymentSucceeded } from '@modules/payments/complete-on-payment-succeeded.js';
import { createShipmentOnOrderPaid } from '@modules/shipping/create-shipment-on-order-paid.js';
import { advanceShipment } from '@modules/shipping/advance-shipment.js';
import { signWebhook } from '@modules/payments/webhook-signature.js';
import { buildTestApp, registerAndLogin } from '@test/helpers/build-test-app.js';
import { resetDb } from '@test/helpers/reset-db.js';
import { counterValue } from '@test/helpers/metric-value.js';

const log = pino({ level: 'silent' }) as unknown as FastifyBaseLogger;
const SECRET = process.env.WEBHOOK_HMAC_SECRET!;

/** Wraps the latest outbox row of an event type into the ConsumeMessage a handler expects. */
async function outboxMsg(orderId: string, eventType: string): Promise<ConsumeMessage> {
  const [row] = await db
    .select()
    .from(outboxMessages)
    .where(and(eq(outboxMessages.aggregateId, orderId), eq(outboxMessages.eventType, eventType)))
    .orderBy(desc(outboxMessages.createdAt))
    .limit(1);
  const envelope = {
    eventId: row!.eventId,
    eventType: row!.eventType,
    correlationId: row!.correlationId ?? orderId,
    occurredAt: row!.createdAt.toISOString(),
    payload: row!.payload,
  };
  return {
    content: Buffer.from(JSON.stringify(envelope)),
    properties: { messageId: row!.eventId },
    fields: {},
  } as unknown as ConsumeMessage;
}

describe('e2e — full happy path (place → reserve → pay → ship → deliver)', () => {
  let app: AppInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  beforeEach(async () => {
    await resetDb();
    await app.redis.flushdb();
  });

  it('drives an order to delivered with correlationId consistent across every event', async () => {
    const before = {
      created: await counterValue('saga_orders_created_total'),
      reserved: await counterValue('saga_inventory_reserved_total'),
      succeeded: await counterValue('saga_payments_succeeded_total'),
      delivered: await counterValue('saga_shipments_delivered_total'),
    };

    const { token } = await registerAndLogin(app);
    const [product] = await db
      .insert(products)
      .values({ sku: `SKU-${crypto.randomUUID()}`, name: 'p', priceCents: 100, stockAvailable: 10 })
      .returning();

    // place
    const created = await app
      .inject({
        method: 'POST',
        url: '/orders',
        headers: { authorization: `Bearer ${token}` },
        payload: { items: [{ productId: product!.id, quantity: 2 }] },
      })
      .then((r) => r.json<{ id: string; status: string }>());
    expect(created.status).toBe('pending');
    const orderId = created.id;

    // reserve → payment(pending) + payment.created
    await reserveOnOrderCreated(await outboxMsg(orderId, 'order.created'), { db, log });
    await createPaymentOnReserved(await outboxMsg(orderId, 'inventory.reserved'), { db, log });

    // pay via a signed webhook
    const [payment] = await db.select().from(payments).where(eq(payments.orderId, orderId));
    const raw = JSON.stringify({
      providerEventId: crypto.randomUUID(),
      paymentId: payment!.id,
      outcome: 'SUCCEEDED',
      timestamp: Date.now(),
    });
    const webhook = await app.inject({
      method: 'POST',
      url: '/webhooks/payment',
      headers: { 'content-type': 'application/json', 'x-signature': signWebhook(SECRET, raw) },
      payload: raw,
    });
    expect(webhook.statusCode).toBe(200);

    // complete → order paid + reservation committed + order.paid
    await completeOnPaymentSucceeded(await outboxMsg(orderId, 'payment.succeeded'), { db, log });

    // ship → shipment created, then advance to delivered
    const { shipmentId } = await createShipmentOnOrderPaid(await outboxMsg(orderId, 'order.paid'), {
      db,
      log,
    });
    await advanceShipment(db, shipmentId!, log);
    await advanceShipment(db, shipmentId!, log);
    expect(await advanceShipment(db, shipmentId!, log)).toBe('delivered');

    // final states
    const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
    expect(order!.status).toBe('delivered');
    const [paid] = await db.select().from(payments).where(eq(payments.orderId, orderId));
    expect(paid!.status).toBe('paid');
    const [ship] = await db.select().from(shipments).where(eq(shipments.orderId, orderId));
    expect(ship!.status).toBe('delivered');
    const [prod] = await db.select().from(products).where(eq(products.id, product!.id));
    expect([prod!.stockAvailable, prod!.stockReserved]).toEqual([8, 0]); // committed

    // correlationId == orderId across EVERY emitted event
    const events = await db
      .select()
      .from(outboxMessages)
      .where(eq(outboxMessages.aggregateId, orderId));
    expect(events.length).toBeGreaterThanOrEqual(5); // created, reserved, payment.created, succeeded, paid, shipment.*
    for (const e of events) expect(e.correlationId).toBe(orderId);

    // each milestone bumped exactly its own counter
    expect(await counterValue('saga_orders_created_total')).toBe(before.created + 1);
    expect(await counterValue('saga_inventory_reserved_total')).toBe(before.reserved + 1);
    expect(await counterValue('saga_payments_succeeded_total')).toBe(before.succeeded + 1);
    expect(await counterValue('saga_shipments_delivered_total')).toBe(before.delivered + 1);
  });
});
