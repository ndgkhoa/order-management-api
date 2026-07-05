import { Pool } from 'pg';

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
});

export function closePool(): Promise<void> {
  return pool.end();
}
