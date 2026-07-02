import { sql } from 'drizzle-orm';
import { db } from '@infra/db/client.js';

/**
 * Truncates all app tables between tests for isolation. CASCADE handles the
 * orders → users FK; RESTART IDENTITY keeps it clean. Uses the shared singleton db
 * (bound to the test Postgres container via setup.ts).
 */
export async function resetDb(): Promise<void> {
  await db.execute(
    sql`TRUNCATE TABLE processed_messages, outbox_messages, order_items, orders, products, users RESTART IDENTITY CASCADE`,
  );
}
