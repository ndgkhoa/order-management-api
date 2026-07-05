import { drizzle } from 'drizzle-orm/node-postgres';
import { pool } from '@infra/db/pool';
import * as schema from '@infra/db/schema';

export const db = drizzle({ client: pool, schema });

export type DB = typeof db;

export type Tx = Parameters<Parameters<DB['transaction']>[0]>[0];
