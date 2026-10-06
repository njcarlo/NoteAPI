import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDays, CLINIC_TIMEZONE, todayIn, zonedToUtc } from '@clinic/shared';
import type { App } from '../src/app';
import {
  appointments,
  doctorProfiles,
  memberships,
  patients,
  prescriptions,
  referrals,
  rxFavorites,
  scheduleExceptions,
  schedules,
  soapTemplates,
  visits,
} from '../src/db/schema';
import { referenceCode } from '../src/lib/reference';
import {
  createClinicFixture,
  owner,
  signIn,
  startApp,
  type ClinicFixture,
  type SignedIn,
} from './helpers';

/**
 * Every route must be listed here. Adding a route without classifying it fails this file, so new
 * endpoints always get an explicit cross-clinic check.
 */
const PUBLIC = new Set([
  'OPTIONS *',
  'GET /api/health',
  'POST /api/auth/login',
  'GET /api/public/clinics/:slug',
  'GET /api/public/clinics/:slug/days',
  'GET /api/public/clinics/:slug/slots',
  'GET /api/public/clinics/:slug/logo',
  'POST /api/public/clinics/:slug/bookings',
  'GET /api/public/cancel/:token',
  'POST /api/public/cancel/:token',
  'GET /api/public/rx/:token',
  'POST /api/public/rx/:token',
  'GET /api/public/opt-out/:token',
  'POST /api/public/opt-out/:token',
  'POST /api/webhooks/sms/inbound',
]);

/** Signed in, but not tied to one clinic's data (or platform-wide, tested in platform.test.ts). */
const SESSION = new Set([
  'GET /api/auth/me',
  'POST /api/auth/logout',
  'POST /api/auth/active-clinic',
  'GET /api/platform/clinics',
  'POST /api/platform/clinics',
  'PATCH /api/platform/clinics/:id',
  'GET /api/events',
]);

const PNG = '';
const MARKER = 'ISOLATIONA';

interface Ids {
  doctor: string;
  secretary: string;
  patient: string;
  booked: string;
  inConsult: string;
  finished: string;
  visit: string;
  prescription: string;
  exception: string;
  favorite: string;
  template: string;
  referral: string;
}

type Attempt = { path: (ids: Ids) => string; body?: (ids: Ids) => object };

const future = () =>
  zonedToUtc(addDays(todayIn(CLINIC_TIMEZONE), 5), '09:00', CLINIC_TIMEZONE).toISOString();

/**
 * Clinic-scoped routes, each tried by clinic B's admin-doctor against clinic A's records.
 * `own: true` routes only ever act on the caller's own clinic (no foreign id can be passed);
 * they must succeed and must not expose clinic A.
 */
const TENANT: Record<string, Attempt & { own?: true }> = {
  'GET /api/clinic': { own: true, path: () => '/api/clinic' },
  'PUT /api/clinic': {
    own: true,
    path: () => '/api/clinic',
    body: () => ({ name: 'Clinic B renamed' }),
  },
  'PUT /api/clinic/logo': {
    own: true,
    path: () => '/api/clinic/logo',
    body: () => ({ contentType: 'image/png', data: PNG }),
  },
  'DELETE /api/clinic/logo': { own: true, path: () => '/api/clinic/logo' },
  'GET /api/patients': { own: true, path: () => `/api/patients?q=${MARKER}` },
  'POST /api/patients': {
    own: true,
    path: () => '/api/patients',
    body: () => ({ firstName: 'B', lastName: 'Patient', mobile: '09170009991' }),
  },
  'GET /api/patients/:id': { path: (i) => `/api/patients/${i.patient}` },
  'PATCH /api/patients/:id': {
    path: (i) => `/api/patients/${i.patient}`,
    body: () => ({ firstName: 'Hacked' }),
  },
  'GET /api/patients/:id/visits': { path: (i) => `/api/patients/${i.patient}/visits` },
  'GET /api/staff': { own: true, path: () => '/api/staff' },
  'POST /api/staff': {
    own: true,
    path: () => '/api/staff',
    body: () => ({
      name: 'B Staff',
      email: `b-staff-${Date.now()}@test.local`,
      roles: ['secretary'],
      password: 'LongEnough#123',
    }),
  },
  'PATCH /api/staff/:id': {
    path: (i) => `/api/staff/${i.secretary}`,
    body: () => ({ isActive: false }),
  },
  'GET /api/audit-logs': { own: true, path: (i) => `/api/audit-logs?entityId=${i.patient}` },
  'GET /api/doctors': { own: true, path: () => '/api/doctors' },
  'GET /api/doctors/:id/schedule': { path: (i) => `/api/doctors/${i.doctor}/schedule` },
  'PUT /api/doctors/:id/schedule': {
    path: (i) => `/api/doctors/${i.doctor}/schedule`,
    body: () => ({ blocks: [] }),
  },
  'GET /api/doctors/:id/slots': {
    path: (i) => `/api/doctors/${i.doctor}/slots?date=${addDays(todayIn(CLINIC_TIMEZONE), 5)}`,
  },
  'POST /api/doctors/:id/exceptions': {
    path: (i) => `/api/doctors/${i.doctor}/exceptions`,
    body: () => ({ date: addDays(todayIn(CLINIC_TIMEZONE), 9), isClosed: true }),
  },
  'DELETE /api/doctors/:id/exceptions/:exceptionId': {
    path: (i) => `/api/doctors/${i.doctor}/exceptions/${i.exception}`,
  },
  'GET /api/doctors/:id/profile': { path: (i) => `/api/doctors/${i.doctor}/profile` },
  'PUT /api/doctors/:id/profile': {
    path: (i) => `/api/doctors/${i.doctor}/profile`,
    body: () => ({ prcNo: '9999999' }),
  },
  'PUT /api/doctors/:id/signature': {
    path: (i) => `/api/doctors/${i.doctor}/signature`,
    body: () => ({ contentType: 'image/png', data: PNG }),
  },
  'DELETE /api/doctors/:id/signature': { path: (i) => `/api/doctors/${i.doctor}/signature` },
  'GET /api/appointments': {
    own: true,
    path: () =>
      `/api/appointments?from=${todayIn(CLINIC_TIMEZONE)}&to=${addDays(todayIn(CLINIC_TIMEZONE), 10)}`,
  },
  'POST /api/appointments': {
    path: () => '/api/appointments',
    body: (i) => ({ doctorId: i.doctor, patientId: i.patient, startAt: future() }),
  },
  'GET /api/appointments/:id': { path: (i) => `/api/appointments/${i.booked}` },
  'PATCH /api/appointments/:id': {
    path: (i) => `/api/appointments/${i.booked}`,
    body: () => ({ startAt: future() }),
  },
  'POST /api/appointments/:id/cancel': { path: (i) => `/api/appointments/${i.booked}/cancel` },
  'POST /api/appointments/:id/no-show': { path: (i) => `/api/appointments/${i.booked}/no-show` },
  'POST /api/appointments/:id/check-in': {
    path: (i) => `/api/appointments/${i.booked}/check-in`,
    body: () => ({}),
  },
  'PUT /api/appointments/:id/vitals': {
    path: (i) => `/api/appointments/${i.inConsult}/vitals`,
    body: () => ({ heartRate: 80 }),
  },
  'POST /api/appointments/:id/call': { path: (i) => `/api/appointments/${i.booked}/call` },
  'POST /api/appointments/:id/requeue': { path: (i) => `/api/appointments/${i.inConsult}/requeue` },
  'POST /api/walk-ins': {
    path: () => '/api/walk-ins',
    body: (i) => ({ doctorId: i.doctor, patientId: i.patient }),
  },
  'GET /api/queue': { own: true, path: () => '/api/queue' },
  'POST /api/queue/call-next': { own: true, path: () => '/api/queue/call-next' },
  'GET /api/consult/:id': { path: (i) => `/api/consult/${i.inConsult}` },
  'PUT /api/consult/:id/draft': {
    path: (i) => `/api/consult/${i.inConsult}/draft`,
    body: () => ({ soap: { subjective: 'x' } }),
  },
  'POST /api/consult/:id/finish': {
    path: (i) => `/api/consult/${i.inConsult}/finish`,
    body: () => ({ soap: {} }),
  },
  'POST /api/visits/:id/amendments': {
    path: (i) => `/api/visits/${i.visit}/amendments`,
    body: () => ({ field: 'plan', newValue: 'Hacked', reason: 'Not allowed' }),
  },
  'GET /api/prescriptions/:id/pdf': { path: (i) => `/api/prescriptions/${i.prescription}/pdf` },
  'POST /api/prescriptions/:id/share': {
    path: (i) => `/api/prescriptions/${i.prescription}/share`,
  },
  'GET /api/drugs': { own: true, path: () => '/api/drugs?q=para' },
  'GET /api/rx-favorites': { own: true, path: () => '/api/rx-favorites' },
  'POST /api/rx-favorites': {
    own: true,
    path: () => '/api/rx-favorites',
    body: () => ({
      name: 'B fav',
      items: [{ genericName: 'Paracetamol', sig: 'x', quantity: '1' }],
    }),
  },
  'DELETE /api/rx-favorites/:id': { path: (i) => `/api/rx-favorites/${i.favorite}` },
  'GET /api/soap-templates': { own: true, path: () => '/api/soap-templates' },
  'POST /api/soap-templates': {
    own: true,
    path: () => '/api/soap-templates',
    body: () => ({ name: 'B tpl', plan: 'x' }),
  },
  'DELETE /api/soap-templates/:id': { path: (i) => `/api/soap-templates/${i.template}` },
  'GET /api/referrals': { own: true, path: () => '/api/referrals?box=to_schedule' },
  'GET /api/referrals/:id': { path: (i) => `/api/referrals/${i.referral}` },
  'GET /api/referrals/:id/pdf': { path: (i) => `/api/referrals/${i.referral}/pdf` },
  'GET /api/patients/:id/referrals': { path: (i) => `/api/patients/${i.patient}/referrals` },
  'POST /api/visits/:id/referrals': {
    path: (i) => `/api/visits/${i.visit}/referrals`,
    body: () => ({ specialty: 'Cardiology', reason: 'Cross-clinic attempt' }),
  },
  'POST /api/referrals/:id/schedule': {
    path: (i) => `/api/referrals/${i.referral}/schedule`,
    body: () => ({ startAt: future() }),
  },
  'POST /api/referrals/:id/decline': {
    path: (i) => `/api/referrals/${i.referral}/decline`,
    body: () => ({ note: 'Cross-clinic attempt' }),
  },
  'POST /api/referrals/:id/cancel': { path: (i) => `/api/referrals/${i.referral}/cancel` },
  'GET /api/notification-templates': { own: true, path: () => '/api/notification-templates' },
  'PUT /api/notification-templates/:event/:channel': {
    own: true,
    path: () => '/api/notification-templates/appointment.booked/sms',
    body: () => ({ body: 'Hi {{firstName}}' }),
  },
  'POST /api/notification-templates/:event/:channel/reset': {
    own: true,
    path: () => '/api/notification-templates/appointment.booked/sms/reset',
  },
  'GET /api/notification-logs': { own: true, path: () => '/api/notification-logs' },
};

let app: App;
let a: ClinicFixture;
let b: ClinicFixture;
let bAdmin: SignedIn;
let ids: Ids;

async function seedClinicA(): Promise<Ids> {
  const c = a.clinicId;
  const doctor = a.userIds.doctor;
  const [patient] = await owner.db
    .insert(patients)
    .values({
      clinicId: c,
      firstName: MARKER,
      lastName: 'Patient',
      birthdate: '1980-01-01',
      mobile: '+639170007777',
    })
    .returning();
  const appt = async (status: 'booked' | 'in_consult' | 'done', startAt: Date) =>
    (
      await owner.db
        .insert(appointments)
        .values({
          clinicId: c,
          doctorId: doctor,
          patientId: patient!.id,
          startAt,
          endAt: new Date(startAt.getTime() + 15 * 60_000),
          status,
          referenceCode: referenceCode(),
        })
        .returning()
    )[0]!;
  const booked = await appt('booked', new Date(future()));
  const inConsult = await appt('in_consult', new Date(Date.now() - 30 * 60_000));
  const finished = await appt('done', new Date(Date.now() - 3 * 86_400_000));
  await owner.db
    .insert(visits)
    .values({ clinicId: c, appointmentId: inConsult.id, patientId: patient!.id, doctorId: doctor });
  const [visit] = await owner.db
    .insert(visits)
    .values({
      clinicId: c,
      appointmentId: finished.id,
      patientId: patient!.id,
      doctorId: doctor,
      plan: 'Original plan',
      locked: true,
      finishedAt: new Date(),
    })
    .returning();
  const [rx] = await owner.db
    .insert(prescriptions)
    .values({ clinicId: c, visitId: visit!.id, doctorId: doctor, patientId: patient!.id })
    .returning();
  await owner.db.insert(schedules).values({
    clinicId: c,
    doctorId: doctor,
    dayOfWeek: 1,
    startTime: '08:00',
    endTime: '12:00',
    slotMinutes: 15,
  });
  const [exception] = await owner.db
    .insert(scheduleExceptions)
    .values({
      clinicId: c,
      doctorId: doctor,
      date: addDays(todayIn(CLINIC_TIMEZONE), 20),
      isClosed: true,
    })
    .returning();
  const [favorite] = await owner.db
    .insert(rxFavorites)
    .values({ clinicId: c, doctorId: doctor, name: 'A fav', items: [] })
    .returning();
  const [template] = await owner.db
    .insert(soapTemplates)
    .values({ clinicId: c, doctorId: doctor, name: 'A tpl' })
    .returning();
  const [referral] = await owner.db
    .insert(referrals)
    .values({
      clinicId: c,
      visitId: visit!.id,
      patientId: patient!.id,
      fromDoctorId: doctor,
      toDoctorId: doctor,
      specialty: 'Cardiology',
      reason: MARKER,
    })
    .returning();
  return {
    doctor,
    secretary: a.userIds.secretary,
    patient: patient!.id,
    booked: booked.id,
    inConsult: inConsult.id,
    finished: finished.id,
    visit: visit!.id,
    prescription: rx!.id,
    exception: exception!.id,
    favorite: favorite!.id,
    template: template!.id,
    referral: referral!.id,
  };
}

const call = (
  agent: SignedIn['agent'] | ReturnType<typeof request>,
  method: string,
  path: string,
  csrf?: string,
  body?: object,
) => {
  const req = (agent as ReturnType<typeof request>)[method.toLowerCase() as 'get'](path);
  if (csrf) req.set('x-csrf-token', csrf);
  return body ? req.send(body) : req;
};

beforeAll(async () => {
  app = await startApp();
  a = await createClinicFixture('iso-a');
  b = await createClinicFixture('iso-b');
  ids = await seedClinicA();
  bAdmin = await signIn(app, b.emails.doctor);
});
afterAll(() => app.close());

describe('route inventory', () => {
  it('classifies every route', () => {
    const unclassified = app.routeList
      .map((r) => `${r.method} ${r.url}`)
      .filter((key) => !PUBLIC.has(key) && !SESSION.has(key) && !(key in TENANT));
    expect(unclassified).toEqual([]);
  });

  it('rejects anonymous requests to every non-public route', async () => {
    for (const key of [...SESSION, ...Object.keys(TENANT)]) {
      const [method, url] = key.split(' ') as [string, string];
      const path = url.replace(/:[a-zA-Z]+/g, '00000000-0000-4000-8000-000000000000');
      const res = await call(
        request(app.server),
        method,
        path,
        undefined,
        method === 'GET' ? undefined : {},
      );
      expect([key, res.status]).toEqual([key, 401]);
    }
  });
});

describe('cross-clinic access', () => {
  it('never lets clinic B read or change clinic A records through any route', async () => {
    for (const [key, attempt] of Object.entries(TENANT)) {
      const [method] = key.split(' ') as [string];
      const res = await call(
        bAdmin.agent,
        method,
        attempt.path(ids),
        bAdmin.csrf,
        attempt.body?.(ids),
      );
      const text = JSON.stringify(res.body ?? '') + (res.text ?? '');
      if (attempt.own) {
        expect([key, res.status < 500]).toEqual([key, true]);
      } else {
        expect([key, res.status >= 400 && res.status < 500]).toEqual([key, true]);
      }
      expect([key, text.includes(MARKER)]).toEqual([key, false]);
      for (const id of Object.values(ids)) {
        if (id === ids.doctor && key.startsWith('GET /api/doctors/:id')) continue;
        expect([key, text.includes(id)]).toEqual([key, false]);
      }
    }
  });

  it('left clinic A exactly as it was', async () => {
    const [patient] = await owner.db.select().from(patients).where(eq(patients.id, ids.patient));
    expect(patient?.firstName).toBe(MARKER);
    const [booked] = await owner.db
      .select()
      .from(appointments)
      .where(eq(appointments.id, ids.booked));
    expect(booked?.status).toBe('booked');
    const [consult] = await owner.db
      .select()
      .from(appointments)
      .where(eq(appointments.id, ids.inConsult));
    expect(consult?.status).toBe('in_consult');
    const [visit] = await owner.db.select().from(visits).where(eq(visits.id, ids.visit));
    expect(visit?.plan).toBe('Original plan');
    const [secretary] = await owner.db
      .select()
      .from(memberships)
      .where(eq(memberships.userId, ids.secretary));
    expect(secretary?.isActive).toBe(true);
    expect(
      await owner.db.select().from(schedules).where(eq(schedules.doctorId, ids.doctor)),
    ).toHaveLength(1);
    expect(
      await owner.db
        .select()
        .from(scheduleExceptions)
        .where(eq(scheduleExceptions.id, ids.exception)),
    ).toHaveLength(1);
    expect(
      await owner.db.select().from(rxFavorites).where(eq(rxFavorites.id, ids.favorite)),
    ).toHaveLength(1);
    expect(
      await owner.db.select().from(soapTemplates).where(eq(soapTemplates.id, ids.template)),
    ).toHaveLength(1);
    const [profile] = await owner.db
      .select()
      .from(doctorProfiles)
      .where(eq(doctorProfiles.userId, ids.doctor));
    expect(profile).toMatchObject({ prcNo: '1234567', signatureUrl: null });
    const appts = await owner.db
      .select()
      .from(appointments)
      .where(eq(appointments.patientId, ids.patient));
    expect(appts).toHaveLength(3);
    const [referral] = await owner.db
      .select()
      .from(referrals)
      .where(eq(referrals.id, ids.referral));
    expect(referral).toMatchObject({ status: 'pending', scheduledAppointmentId: null });
    expect(
      await owner.db.select().from(referrals).where(eq(referrals.visitId, ids.visit)),
    ).toHaveLength(1);
  });
});

describe('response headers', () => {
  it('sends security headers and never caches API data', async () => {
    const res = await bAdmin.agent.get('/api/patients');
    expect(res.headers).toMatchObject({
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      'cache-control': 'no-store',
      'cross-origin-resource-policy': 'same-origin',
    });
    expect(res.headers['strict-transport-security']).toMatch(/max-age=\d+/);
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('allows only the web origin for CORS', async () => {
    const res = await request(app.server)
      .options('/api/patients')
      .set('origin', 'https://evil.example')
      .set('access-control-request-method', 'GET');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});
