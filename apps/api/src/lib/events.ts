import { EventEmitter } from 'node:events';
import { sql } from 'drizzle-orm';
import type { ClinicEvent } from '@clinic/shared';
import type { TenantScope } from '../db/tenant';

export const EVENTS_CHANNEL = 'clinic_events';

export interface ClinicEventEnvelope {
  clinicId: string;
  event: ClinicEvent;
}

/**
 * Publishes a change through Postgres NOTIFY. It is delivered only if the transaction commits,
 * and reaches every API instance listening on the channel. Payloads carry ids, never PHI.
 */
export async function publishAppointmentsChanged(t: TenantScope, doctorId: string): Promise<void> {
  const envelope: ClinicEventEnvelope = {
    clinicId: t.clinicId,
    event: { type: 'appointments.changed', doctorId },
  };
  await t.tx.execute(sql`select pg_notify(${EVENTS_CHANNEL}, ${JSON.stringify(envelope)})`);
}

/** In-process fan-out of events received from Postgres, keyed by clinic id. */
export const clinicEvents = new EventEmitter();
clinicEvents.setMaxListeners(0);
