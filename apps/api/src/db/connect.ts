import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

export function createDb(url: string, max = 10) {
  const client = postgres(url, { max, onnotice: () => undefined });
  return { db: drizzle(client, { schema, casing: 'snake_case' }), client };
}

export type Database = ReturnType<typeof createDb>['db'];
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
