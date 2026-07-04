import { sql } from 'drizzle-orm';
import { db } from '@infra/db/client.js';

/**
 * Truncates every app table between tests for isolation. All tables are listed explicitly (rather
 * than relying on CASCADE to reach payments/shipments/order_status_history via the orders FK) so a
 * newly added table is reset intentionally, not by accident. RESTART IDENTITY keeps it clean;
 * CASCADE remains as a safety net. Uses the shared singleton db (bound to the test container).
 */
export async function resetDb(): Promise<void> {
  await db.execute(
    sql`TRUNCATE TABLE processed_messages, outbox_messages, order_status_history, order_items, payments, shipments, orders, products, users RESTART IDENTITY CASCADE`,
  );
}
