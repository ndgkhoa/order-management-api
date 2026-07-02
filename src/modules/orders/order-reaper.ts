import { and, eq, lt } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type { DB } from '@infra/db/client.js';
import { orders } from '@infra/db/schema.js';

interface OrderReaperDeps {
  db: DB;
  log: FastifyBaseLogger;
  intervalMs: number;
  thresholdMs: number;
}

/**
 * Stuck-order reaper: periodically flags orders left `pending` longer than `thresholdMs`
 * (e.g. a saga step whose event was lost). Observability-first — it logs the stuck orders
 * for alerting / manual recovery; it does NOT auto-cancel (that risks cancelling a
 * legitimately slow order). Runs in the worker process alongside the relay.
 */
export function createOrderReaper({ db, log, intervalMs, thresholdMs }: OrderReaperDeps) {
  let timer: NodeJS.Timeout | null = null;
  let running = false;

  async function sweep(): Promise<number> {
    if (running) return 0;
    running = true;
    try {
      const cutoff = new Date(Date.now() - thresholdMs);
      const stuck = await db
        .select({ id: orders.id, createdAt: orders.createdAt })
        .from(orders)
        .where(and(eq(orders.status, 'pending'), lt(orders.createdAt, cutoff)));
      if (stuck.length > 0) {
        log.warn(
          { count: stuck.length, orderIds: stuck.map((o) => o.id), thresholdMs },
          'stuck pending orders detected — needs investigation / manual recovery',
        );
      }
      return stuck.length;
    } catch (err) {
      log.error({ err }, 'order reaper sweep failed; will retry next tick');
      return 0;
    } finally {
      running = false;
    }
  }

  return {
    sweep, // exposed so tests can drive a single sweep deterministically
    start(): void {
      if (timer) return;
      timer = setInterval(() => void sweep(), intervalMs);
      log.info({ intervalMs, thresholdMs }, 'order reaper started');
    },
    stop(): void {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },
  };
}

export type OrderReaper = ReturnType<typeof createOrderReaper>;
