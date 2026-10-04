import { sql } from 'drizzle-orm';
import {
  addDays,
  CLINIC_TIMEZONE,
  todayIn,
  zonedToUtc,
  type AppointmentStatus,
  type Sex,
} from '@clinic/shared';
import { referenceCode } from '../lib/reference';

import { createDb } from './connect';
import { provisionClinic, upsertPerson } from './provision';
import {
  appointments,
  drugs,
  patients,
  prescriptionItems,
  prescriptions,
  rxFavorites,
  schedules,
  visits,
  type RxFavoriteItem,
} from './schema';
import { DRUGS } from './seed-data/drugs';

export const SEED_ACCOUNTS = {
  doctor: { email: 'doctor@sample.clinic', password: 'DemoDoctor#2026' },
  doctor2: { email: 'doctor2@sample.clinic', password: 'DemoDoctor#2026' },
  doctor3: { email: 'doctor3@sample.clinic', password: 'DemoDoctor#2026' },
  soloDoctor: { email: 'solo@sample.clinic', password: 'DemoDoctor#2026' },
  secretary: { email: 'secretary@sample.clinic', password: 'DemoSecretary#2026' },
  imusSecretary: { email: 'imus.secretary@sample.clinic', password: 'DemoSecretary#2026' },
  platform: { email: 'platform@sample.clinic', password: 'DemoPlatform#2026' },
};

const FIRST_NAMES = [
  'Juan',
  'Maria',
  'Jose',
  'Ana',
  'Pedro',
  'Rosa',
  'Carlo',
  'Liza',
  'Ramon',
  'Grace',
  'Miguel',
  'Joy',
  'Paolo',
  'Bea',
  'Andres',
  'Clarissa',
  'Nico',
  'Tess',
  'Rafael',
  'Camille',
];
const LAST_NAMES = ['Sampleton', 'Demoya', 'Testerio', 'Fakeda', 'Mockado'];

if (process.env.NODE_ENV === 'production') {
  throw new Error('Refusing to seed demo data in production');
}
const url = process.env.MIGRATION_DATABASE_URL;
if (!url) throw new Error('MIGRATION_DATABASE_URL is required');
const { db, client } = createDb(url, 1);

try {
  await db.execute(sql`
    truncate table audit_logs, notification_logs, outbox, notification_templates, rx_share_tokens,
      prescription_items, prescriptions, rx_favorites, soap_templates, visit_amendments, visits, appointments,
      patients, schedule_exceptions, schedules, secretary_assignments, doctor_profiles, sessions,
      memberships, users, clinics, drugs
    restart identity cascade
  `);

  await upsertPerson(db, {
    name: 'Platform Demo Admin',
    email: SEED_ACCOUNTS.platform.email,
    password: SEED_ACCOUNTS.platform.password,
    isPlatformAdmin: true,
  });

  const drSantos = {
    name: 'Maria Demo Santos, MD',
    email: SEED_ACCOUNTS.doctor.email,
    password: SEED_ACCOUNTS.doctor.password,
  };
  const {
    clinic,
    userIds: [doctorId, doctor2Id, doctor3Id],
  } = await provisionClinic(
    db,
    {
      slug: 'sample-family-clinic',
      name: 'Sample Family Clinic',
      address: 'Unit 1, Sample Bldg., Aguinaldo Hwy., Salitran, Dasmariñas, Cavite',
      contactNumber: '+639170000000',
      email: 'hello@sample.clinic',
    },
    [
      {
        ...drSantos,
        roles: ['admin', 'doctor'],
        doctor: { specialty: 'Family Medicine', prcNo: '0000001', ptrNo: 'DEMO-DAS-0000001' },
      },
      {
        name: 'Jose Demo Cruz, MD',
        email: SEED_ACCOUNTS.doctor2.email,
        password: SEED_ACCOUNTS.doctor2.password,
        roles: ['doctor'],
        doctor: { specialty: 'Pediatrics', prcNo: '0000002', ptrNo: 'DEMO-DAS-0000002' },
      },
      {
        name: 'Grace Demo Lim, MD',
        email: SEED_ACCOUNTS.doctor3.email,
        password: SEED_ACCOUNTS.doctor3.password,
        roles: ['doctor'],
        doctor: {
          specialty: 'Obstetrics and Gynecology',
          prcNo: '0000003',
          ptrNo: 'DEMO-DAS-0000003',
        },
      },
      {
        name: 'Ana Demo Reyes',
        email: SEED_ACCOUNTS.secretary.email,
        password: SEED_ACCOUNTS.secretary.password,
        roles: ['secretary'],
      },
    ],
  );
  const doctor = { id: doctorId as string };
  const clinicId = clinic.id;

  // A solo practice: one doctor who is also the admin and runs the front desk. No secretary.
  const {
    clinic: solo,
    userIds: [soloDoctorId],
  } = await provisionClinic(
    db,
    {
      slug: 'sample-solo-practice',
      name: 'Sample Solo Practice',
      address: 'Room 2, Sample Arcade, Gen. Trias, Cavite',
      contactNumber: '+639170000077',
    },
    [
      {
        name: 'Ramon Demo Bautista, MD',
        email: SEED_ACCOUNTS.soloDoctor.email,
        password: SEED_ACCOUNTS.soloDoctor.password,
        roles: ['admin', 'doctor'],
        doctor: { specialty: 'Internal Medicine', prcNo: '0000004', ptrNo: 'DEMO-GT-0000004' },
      },
    ],
  );
  await db.insert(schedules).values(
    [1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
      clinicId: solo.id,
      doctorId: soloDoctorId as string,
      dayOfWeek,
      startTime: '09:00',
      endTime: '16:00',
      slotMinutes: 20,
    })),
  );

  // Dr. Santos also holds clinic hours in Imus, as a doctor only (another admin runs it).
  const { clinic: imus } = await provisionClinic(
    db,
    {
      slug: 'sample-imus-clinic',
      name: 'Sample Imus Clinic',
      address: 'Sample Medical Arts Bldg., Nueno Ave., Imus, Cavite',
      contactNumber: '+639170000099',
    },
    [
      {
        ...drSantos,
        roles: ['doctor'],
        doctor: { specialty: 'Family Medicine', prcNo: '0000001', ptrNo: 'DEMO-IMS-0000001' },
      },
      {
        name: 'Liza Demo Imus',
        email: SEED_ACCOUNTS.imusSecretary.email,
        password: SEED_ACCOUNTS.imusSecretary.password,
        roles: ['admin', 'secretary'],
      },
    ],
  );
  await db.insert(schedules).values(
    [2, 4].map((dayOfWeek) => ({
      clinicId: imus.id,
      doctorId: doctor.id,
      dayOfWeek,
      startTime: '14:00',
      endTime: '18:00',
      slotMinutes: 15,
    })),
  );
  await db.insert(patients).values(
    ['Imelda', 'Ruben', 'Celia'].map((firstName, i) => ({
      clinicId: imus.id,
      firstName,
      middleName: 'Demo',
      lastName: 'Imusano',
      birthdate: `198${i}-0${i + 1}-1${i}`,
      sex: (i % 2 === 0 ? 'female' : 'male') as Sex,
      mobile: `+63917000${String(i + 90).padStart(4, '0')}`,
      privacyConsentAt: new Date(),
    })),
  );

  // Dr. Santos: Mon–Sat, 08:00–12:00 and 13:00–17:00. Dr. Cruz: Mon/Wed/Fri afternoons.
  const block = (
    doctorId: string,
    dayOfWeek: number,
    startTime: string,
    endTime: string,
    slotMinutes: number,
  ) => ({
    clinicId,
    doctorId,
    dayOfWeek,
    startTime,
    endTime,
    slotMinutes,
  });
  await db
    .insert(schedules)
    .values([
      ...[1, 2, 3, 4, 5, 6].flatMap((day) => [
        block(doctor.id, day, '08:00', '12:00', 15),
        block(doctor.id, day, '13:00', '17:00', 15),
      ]),
      ...[1, 3, 5].map((day) => block(doctor2Id as string, day, '13:00', '17:00', 20)),
      ...[2, 4].map((day) => block(doctor3Id as string, day, '09:00', '15:00', 30)),
    ]);

  const drugRows = await db
    .insert(drugs)
    .values(DRUGS.map((d) => ({ ...d, brandName: d.brandName ?? null })))
    .returning();
  const drug = (generic: string, strength?: string) => {
    const found = drugRows.find(
      (d) => d.genericName === generic && (!strength || d.strength === strength),
    );
    if (!found) throw new Error(`Seed drug missing: ${generic}`);
    return found;
  };
  const item = (
    generic: string,
    strength: string,
    sig: string,
    quantity: string,
  ): RxFavoriteItem => {
    const d = drug(generic, strength);
    return {
      drugId: d.id,
      genericName: d.genericName,
      brandName: d.brandName,
      strength: d.strength,
      form: d.form,
      sig,
      quantity,
    };
  };

  const favorites = {
    uri: [
      item('Paracetamol', '500 mg', '1 tablet every 4 hours as needed for fever', '#10'),
      item('Cetirizine', '10 mg', '1 tablet once a day at bedtime for 5 days', '#5'),
      item('Carbocisteine', '500 mg', '1 capsule 3 times a day for 5 days', '#15'),
    ],
    uti: [item('Nitrofurantoin', '100 mg', '1 capsule twice a day for 7 days', '#14')],
    hypertension: [
      item('Amlodipine', '5 mg', '1 tablet once a day', '#30'),
      item('Losartan', '50 mg', '1 tablet once a day', '#30'),
    ],
  };
  await db.insert(rxFavorites).values([
    { clinicId, doctorId: doctor.id, name: 'URI / common cold', items: favorites.uri },
    { clinicId, doctorId: doctor.id, name: 'Uncomplicated UTI', items: favorites.uti },
    {
      clinicId,
      doctorId: doctor.id,
      name: 'Hypertension maintenance',
      items: favorites.hypertension,
    },
  ]);

  const patientRows = await db
    .insert(patients)
    .values(
      FIRST_NAMES.map((firstName, i) => ({
        clinicId,
        firstName,
        middleName: 'Demo',
        lastName: LAST_NAMES[i % LAST_NAMES.length] as string,
        birthdate: `${1950 + ((i * 7) % 65)}-${String((i % 12) + 1).padStart(2, '0')}-${String((i % 27) + 1).padStart(2, '0')}`,
        sex: (i % 2 === 0 ? 'male' : 'female') as Sex,
        mobile: `+63917000${String(i + 1).padStart(4, '0')}`,
        email: i % 3 === 0 ? `patient${i + 1}@example.com` : null,
        address: `${i + 1} Sample St., Dasmariñas, Cavite`,
        allergies: i === 1 ? 'Penicillin' : i === 4 ? 'Sulfa drugs' : null,
        conditions: i % 5 === 0 ? 'Hypertension' : i === 3 ? 'Type 2 diabetes' : null,
        privacyConsentAt: new Date(),
      })),
    )
    .returning();
  const patient = (i: number) => patientRows[i] as (typeof patientRows)[number];

  const today = todayIn(CLINIC_TIMEZONE);
  const slot = (date: string, time: string) => {
    const startAt = zonedToUtc(date, time, CLINIC_TIMEZONE);
    return { startAt, endAt: new Date(startAt.getTime() + 15 * 60_000) };
  };

  // Today: a mix of statuses for the dashboard and queue.
  const todays: { time: string; status: AppointmentStatus; queue?: number; walkIn?: boolean }[] = [
    { time: '08:00', status: 'done', queue: 1 },
    { time: '08:15', status: 'done', queue: 2 },
    { time: '08:30', status: 'in_consult', queue: 3 },
    { time: '08:45', status: 'arrived', queue: 4 },
    { time: '09:00', status: 'arrived', queue: 5, walkIn: true },
    { time: '09:30', status: 'booked' },
    { time: '10:00', status: 'booked' },
    { time: '10:30', status: 'booked' },
    { time: '11:00', status: 'cancelled' },
    { time: '11:15', status: 'no_show' },
  ];
  const todayRows = await db
    .insert(appointments)
    .values(
      todays.map((a, i) => ({
        clinicId,
        doctorId: doctor.id,
        patientId: patient(i).id,
        ...slot(today, a.time),
        type: a.walkIn ? ('walk_in' as const) : ('scheduled' as const),
        status: a.status,
        source: i % 2 === 0 ? ('public' as const) : ('staff' as const),
        reason: 'Consultation',
        referenceCode: referenceCode(),
        queueNumber: a.queue ?? null,
        queueDate: a.queue ? today : null,
        arrivedAt: a.queue ? slot(today, a.time).startAt : null,
      })),
    )
    .returning();

  // Past finished visits with prescriptions, plus today's finished ones.
  const past = [
    { patient: 0, daysAgo: 30, assessment: 'Essential hypertension', rx: favorites.hypertension },
    { patient: 2, daysAgo: 21, assessment: 'Acute upper respiratory infection', rx: favorites.uri },
    {
      patient: 3,
      daysAgo: 14,
      assessment: 'Uncomplicated urinary tract infection',
      rx: favorites.uti,
    },
    { patient: 5, daysAgo: 7, assessment: 'Essential hypertension', rx: favorites.hypertension },
    { patient: 6, daysAgo: 3, assessment: 'Acute upper respiratory infection', rx: favorites.uri },
  ];
  const pastRows = await db
    .insert(appointments)
    .values(
      past.map((p, i) => ({
        clinicId,
        doctorId: doctor.id,
        patientId: patient(p.patient).id,
        ...slot(addDays(today, -p.daysAgo), '09:00'),
        status: 'done' as const,
        reason: 'Consultation',
        referenceCode: referenceCode(),
        queueNumber: i + 1,
        queueDate: addDays(today, -p.daysAgo),
        arrivedAt: slot(addDays(today, -p.daysAgo), '08:55').startAt,
      })),
    )
    .returning();

  const finished = [
    ...past.map((p, i) => ({ ...p, appointment: pastRows[i] as (typeof pastRows)[number] })),
    {
      patient: 0,
      assessment: 'Essential hypertension',
      rx: favorites.hypertension,
      appointment: todayRows[0] as (typeof todayRows)[number],
    },
    {
      patient: 1,
      assessment: 'Acute upper respiratory infection',
      rx: favorites.uri,
      appointment: todayRows[1] as (typeof todayRows)[number],
    },
  ];
  for (const f of finished) {
    const finishedAt = new Date(f.appointment.startAt.getTime() + 10 * 60_000);
    const [visit] = await db
      .insert(visits)
      .values({
        clinicId,
        appointmentId: f.appointment.id,
        patientId: f.appointment.patientId,
        doctorId: doctor.id,
        bpSystolic: 120 + (f.patient % 4) * 5,
        bpDiastolic: 80,
        temperatureC: '36.8',
        heartRate: 78,
        respiratoryRate: 18,
        weightKg: '65.00',
        heightCm: '162.0',
        o2Sat: 98,
        subjective: 'Demo subjective note.',
        objective: 'Demo objective findings.',
        assessment: f.assessment,
        plan: 'Medications as prescribed. Return if symptoms persist.',
        finishedAt,
        locked: true,
      })
      .returning();
    if (!visit) throw new Error('Visit insert returned no row');
    const [rx] = await db
      .insert(prescriptions)
      .values({
        clinicId,
        visitId: visit.id,
        doctorId: doctor.id,
        patientId: f.appointment.patientId,
        issuedAt: finishedAt,
      })
      .returning();
    if (!rx) throw new Error('Prescription insert returned no row');
    await db
      .insert(prescriptionItems)
      .values(f.rx.map((it, sortOrder) => ({ ...it, clinicId, prescriptionId: rx.id, sortOrder })));
  }

  // Today's arrived patients have vitals recorded at check-in; the one in consult has a draft.
  for (const [index, appt] of todayRows.entries()) {
    if (appt.status !== 'arrived' && appt.status !== 'in_consult') continue;
    await db.insert(visits).values({
      clinicId,
      appointmentId: appt.id,
      patientId: appt.patientId,
      doctorId: doctor.id,
      bpSystolic: 118 + index,
      bpDiastolic: 78,
      temperatureC: '37.1',
      heartRate: 82,
      respiratoryRate: 18,
      weightKg: '70.00',
      o2Sat: 98,
    });
  }

  console.log(`Seeded "${clinic.name}", "${imus.name}" and "${solo.name}". Accounts:`);
  for (const [who, account] of Object.entries(SEED_ACCOUNTS)) {
    console.log(`  ${who.padEnd(14)} ${account.email} / ${account.password}`);
  }
} finally {
  await client.end();
}
