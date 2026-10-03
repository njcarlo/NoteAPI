import { and, eq, sql, type SQL } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import { auditLogs } from './schema';
import { db, type Transaction } from './client';

type TenantTable = PgTable & { clinicId: PgColumn };

export interface AuditEntry {
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
}

export interface Actor {
  userId: string | null;
  ip: string | null;
}

/**
 * A transaction bound to one clinic. Every tenant query goes through `where()` / `values()`,
 * and Postgres row-level security (keyed on `app.clinic_id`) rejects anything that slips past.
 */
export class TenantScope {
  constructor(
    readonly tx: Transaction,
    readonly clinicId: string,
    private readonly actor: Actor,
  ) {}

  /** Combines the clinic filter for `table` with any extra conditions. */
  where(table: TenantTable, ...conditions: (SQL | undefined)[]): SQL {
    return and(eq(table.clinicId, this.clinicId), ...conditions) as SQL;
  }

  /** Stamps the clinic id onto insert values. */
  values<T extends object>(values: T): T & { clinicId: string } {
    return { ...values, clinicId: this.clinicId };
  }

  async audit(entry: AuditEntry): Promise<void> {
    await this.tx.insert(auditLogs).values({
      clinicId: this.clinicId,
      userId: this.actor.userId,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      metadata: entry.metadata ?? null,
      ip: this.actor.ip,
    });
  }
}

export async function withTenant<T>(
  clinicId: string,
  actor: Actor,
  fn: (scope: TenantScope) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.clinic_id', ${clinicId}, true)`);
    return fn(new TenantScope(tx, clinicId, actor));
  });
}
