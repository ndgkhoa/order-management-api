import { drizzle } from 'drizzle-orm/node-postgres';
import { pool } from '@infra/db/pool.js';
import * as schema from '@infra/db/schema.js';

export const db = drizzle({ client: pool, schema });

export type DB = typeof db;

export type Tx = Parameters<Parameters<DB['transaction']>[0]>[0];
