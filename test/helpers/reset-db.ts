import { sql } from 'drizzle-orm';
import { db } from '@infra/db/client.js';

export async function resetDb(): Promise<void> {
  await db.execute(
    sql`TRUNCATE TABLE processed_messages, outbox_messages, order_status_history, order_items, payments, shipments, orders, products, users RESTART IDENTITY CASCADE`,
  );
}
