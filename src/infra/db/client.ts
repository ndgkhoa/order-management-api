import { drizzle } from 'drizzle-orm/node-postgres';
import { pool } from './pool.js';
import * as schema from './schema.js';

/**
 * The Drizzle client bound to the pg Pool singleton + full schema.
 * Repositories (phases 05/06) consume this; `db.transaction(...)` is the
 * Unit of Work used by the Transactional Outbox.
 */
export const db = drizzle({ client: pool, schema });

export type DB = typeof db;
