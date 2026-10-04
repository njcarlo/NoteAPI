import { sql } from 'drizzle-orm';
import { createDb } from '../src/db/connect';
import { runMigrations } from '../src/db/migrate';

export default async function setup() {
  const url =
    process.env.TEST_MIGRATION_DATABASE_URL ??
    'postgres://clinic:clinic@localhost:5432/clinic_test';
  await runMigrations(url);
  const { db, client } = createDb(url, 1);
  await db.execute(sql`
    truncate table audit_logs, notification_logs, notification_templates, rx_share_tokens,
      prescription_items, prescriptions, rx_favorites, visit_amendments, visits, appointments,
      patients, schedule_exceptions, schedules, secretary_assignments, doctor_profiles, sessions,
      memberships, users, clinics
    restart identity cascade
  `);
  await client.end();
}
