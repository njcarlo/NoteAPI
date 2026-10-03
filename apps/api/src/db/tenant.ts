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

async function setContext(tx: Transaction, key: 'app.clinic_id' | 'app.user_id', value: string) {
  await tx.execute(sql`select set_config(${key}, ${value}, true)`);
}

async function writeAudit(tx: Transaction, clinicId: string, actor: Actor, entry: AuditEntry) {
  await tx.insert(auditLogs).values({
    clinicId,
    userId: actor.userId,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    metadata: entry.metadata ?? null,
    ip: actor.ip,
  });
}

/**
 * A transaction bound to one clinic. Every tenant query goes through `where()` / `values()`,
 * and Postgres row-level security (keyed on `app.clinic_id`) rejects anything that slips past.
 */
export class TenantScope {
  constructor(
    readonly tx: Transaction,
    readonly clinicId: string,
    readonly actor: Actor,
  ) {}

  /** Combines the clinic filter for `table` with any extra conditions. */
  where(table: TenantTable, ...conditions: (SQL | undefined)[]): SQL {
    return and(eq(table.clinicId, this.clinicId), ...conditions) as SQL;
  }

  /** Stamps the clinic id onto insert values. */
  values<T extends object>(values: T): T & { clinicId: string } {
    return { ...values, clinicId: this.clinicId };
  }

  audit(entry: AuditEntry): Promise<void> {
    return writeAudit(this.tx, this.clinicId, this.actor, entry);
  }
}

export async function withTenant<T>(
  clinicId: string,
  actor: Actor,
  fn: (scope: TenantScope) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await setContext(tx, 'app.clinic_id', clinicId);
    if (actor.userId) await setContext(tx, 'app.user_id', actor.userId);
    return fn(new TenantScope(tx, clinicId, actor));
  });
}

/** A transaction that can see only the given user's own login and memberships. */
export async function withUser<T>(userId: string, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await setContext(tx, 'app.user_id', userId);
    return fn(tx);
  });
}

/** Narrows an open user transaction to one clinic, after membership has been verified. */
export const enterClinic = (tx: Transaction, clinicId: string) =>
  setContext(tx, 'app.clinic_id', clinicId);

export class PlatformScope {
  constructor(
    readonly tx: Transaction,
    readonly actor: Actor,
  ) {}

  audit(clinicId: string, entry: AuditEntry): Promise<void> {
    return writeAudit(this.tx, clinicId, this.actor, entry);
  }
}

/**
 * Runs as the `clinic_platform` database role, which has no grants on patient-data tables:
 * platform code cannot read PHI even through a buggy query.
 */
export async function withPlatform<T>(
  actor: Actor,
  fn: (scope: PlatformScope) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`set local role clinic_platform`);
    return fn(new PlatformScope(tx, actor));
  });
}
