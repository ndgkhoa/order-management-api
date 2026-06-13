import { Pool } from 'pg';

/**
 * node-postgres connection Pool — a Singleton for the process.
 * Both the API and the email-worker import this module; each process gets its
 * own pool (correct: separate processes shouldn't share sockets).
 * `max` is bounded to avoid exhausting Postgres connections.
 */
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
});

/** Closes the pool — wired into graceful shutdown (phase 04). */
export function closePool(): Promise<void> {
  return pool.end();
}
