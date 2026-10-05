import { execSync } from 'node:child_process';
import postgres from 'postgres';
import { apiEnv } from './env';

/**
 * Fresh demo data for every run, plus round-the-clock hours for Dr. Santos so "book a slot today,
 * then check in" works at any time of day (except the last minutes before midnight, Manila).
 */
export default async function globalSetup() {
  const env = { ...process.env, ...apiEnv };
  execSync('pnpm --filter @clinic/api db:migrate', { env, stdio: 'inherit' });
  execSync('pnpm --filter @clinic/api db:seed', { env, stdio: 'ignore' });

  const sql = postgres(apiEnv.MIGRATION_DATABASE_URL!, { max: 1, onnotice: () => undefined });
  try {
    await sql`
      delete from schedules
      where doctor_id = (select id from users where email = 'doctor@sample.clinic')
        and clinic_id = (select id from clinics where slug = 'sample-family-clinic')`;
    await sql`
      insert into schedules (clinic_id, doctor_id, day_of_week, start_time, end_time, slot_minutes)
      select c.id, u.id, d, '00:00', '23:59', 5
      from clinics c, users u, generate_series(0, 6) d
      where c.slug = 'sample-family-clinic' and u.email = 'doctor@sample.clinic'`;
  } finally {
    await sql.end();
  }
}
