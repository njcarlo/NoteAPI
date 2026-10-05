import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

/**
 * Accepts the libpq-style unix socket form used by Cloud SQL on Cloud Run:
 * postgres://user:pass@localhost/db?host=/cloudsql/PROJECT:REGION:INSTANCE
 */
export function connectionOptions(url: string): { url: string; path?: string } {
  const parsed = new URL(url);
  const socketDir = parsed.searchParams.get('host');
  if (!socketDir?.startsWith('/')) return { url };
  parsed.searchParams.delete('host');
  return { url: parsed.toString(), path: `${socketDir}/.s.PGSQL.${parsed.port || 5432}` };
}

export function createDb(url: string, max = 10) {
  const { url: connectionUrl, path } = connectionOptions(url);
  const client = postgres(connectionUrl, {
    max,
    onnotice: () => undefined,
    ...(path ? { path } : {}),
  });
  return { db: drizzle(client, { schema, casing: 'snake_case' }), client };
}

export type Database = ReturnType<typeof createDb>['db'];
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
