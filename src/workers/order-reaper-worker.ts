import type { FastifyBaseLogger } from 'fastify';
import type { DB } from '@infra/db/client.js';
import { makeOrdersRepository } from '@modules/orders/orders-repository.js';

interface OrderReaperDeps {
  db: DB;
  log: FastifyBaseLogger;
  intervalMs: number;
  thresholdMs: number;
}

export function makeOrderReaper({ db, log, intervalMs, thresholdMs }: OrderReaperDeps) {
  let timer: NodeJS.Timeout | null = null;
  let running = false;

  async function sweep(): Promise<number> {
    if (running) return 0;
    running = true;
    try {
      const cutoff = new Date(Date.now() - thresholdMs);
      const ordersRepo = makeOrdersRepository(db);
      const stuck = await ordersRepo.findStuckOrders(cutoff);
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
    sweep,
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

export type OrderReaper = ReturnType<typeof makeOrderReaper>;
