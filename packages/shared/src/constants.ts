export const ROLES = ['admin', 'doctor', 'secretary'] as const;
export type Role = (typeof ROLES)[number];

export const CLINIC_STATUSES = ['active', 'suspended'] as const;
export type ClinicStatus = (typeof CLINIC_STATUSES)[number];

export const APPOINTMENT_STATUSES = [
  'booked',
  'arrived',
  'in_consult',
  'done',
  'cancelled',
  'no_show',
] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

export const APPOINTMENT_TYPES = ['scheduled', 'walk_in'] as const;
export type AppointmentType = (typeof APPOINTMENT_TYPES)[number];

export const APPOINTMENT_SOURCES = ['public', 'staff'] as const;
export type AppointmentSource = (typeof APPOINTMENT_SOURCES)[number];

export const SEXES = ['male', 'female'] as const;
export type Sex = (typeof SEXES)[number];

export const NOTIFICATION_CHANNELS = ['sms', 'email'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

/** `skipped`: nothing was sent on purpose (opted out, no contact, appointment changed). */
export const NOTIFICATION_STATUSES = ['queued', 'sent', 'failed', 'skipped'] as const;
export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number];

export const NOTIFICATION_EVENTS = [
  'appointment.booked',
  'appointment.rescheduled',
  'appointment.cancelled',
  'appointment.reminder',
  'visit.finished',
  'followup.reminder',
  /** Email to the clinic about a new online booking (no patient details). */
  'booking.staff_alert',
] as const;
export type NotificationEvent = (typeof NOTIFICATION_EVENTS)[number];

export const CLINIC_TIMEZONE = 'Asia/Manila';
export const CURRENCY = 'PHP';

export const ERROR_CODES = {
  VALIDATION: 'VALIDATION_ERROR',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  CSRF: 'CSRF_INVALID',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  ALLERGY_WARNING: 'ALLERGY_WARNING',
  ACCOUNT_LOCKED: 'ACCOUNT_LOCKED',
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL: 'INTERNAL_ERROR',
} as const;
export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

/**
 * Specialties a doctor can list and be referred to. One fixed list (PMA specialty societies, plus
 * common subspecialties) so a referral to "Cardiology" finds every cardiologist in the clinic.
 */
export const SPECIALTIES = [
  'Family Medicine',
  'Internal Medicine',
  'Pediatrics',
  'Obstetrics and Gynecology',
  'General Surgery',
  'Orthopedics',
  'Cardiology',
  'Pulmonology',
  'Gastroenterology',
  'Endocrinology',
  'Nephrology',
  'Neurology',
  'Psychiatry',
  'Dermatology',
  'Ophthalmology',
  'Otorhinolaryngology (ENT)',
  'Urology',
  'Oncology',
  'Infectious Diseases',
  'Rheumatology',
  'Allergy and Immunology',
  'Rehabilitation Medicine',
  'Radiology',
  'Anesthesiology',
  'Pathology',
  'Dentistry',
] as const;
export type Specialty = (typeof SPECIALTIES)[number];

export const REFERRAL_URGENCIES = ['routine', 'urgent', 'emergency'] as const;
export type ReferralUrgency = (typeof REFERRAL_URGENCIES)[number];

/**
 * `pending`: waiting to be booked (in-clinic) or handed to the patient (outside the clinic).
 * `scheduled`: booked with the receiving doctor; `completed` once that visit is finished.
 */
export const REFERRAL_STATUSES = [
  'pending',
  'scheduled',
  'completed',
  'declined',
  'cancelled',
] as const;
export type ReferralStatus = (typeof REFERRAL_STATUSES)[number];

/** Places the clinic sends patients to: labs and imaging for tests, hospitals and clinics for care. */
export const FACILITY_KINDS = ['laboratory', 'imaging', 'hospital', 'clinic'] as const;
export type FacilityKind = (typeof FACILITY_KINDS)[number];

/**
 * `requested`: the patient has the slip; `results_in`: a result file was attached and waits for
 * the doctor; `reviewed`: the requesting doctor has seen it.
 */
export const LAB_REQUEST_STATUSES = ['requested', 'results_in', 'reviewed', 'cancelled'] as const;
export type LabRequestStatus = (typeof LAB_REQUEST_STATUSES)[number];

export interface LabTest {
  name: string;
  /** Usually done after an 8–10 hour fast. */
  fasting?: true;
}

/** Common tests for a quick pick; anything else can be typed in. */
export const LAB_TEST_GROUPS: { group: string; tests: LabTest[] }[] = [
  {
    group: 'Hematology',
    tests: [{ name: 'CBC with platelet count' }, { name: 'Blood typing' }, { name: 'ESR' }],
  },
  {
    group: 'Clinical microscopy',
    tests: [{ name: 'Urinalysis' }, { name: 'Fecalysis' }, { name: 'Pregnancy test (urine)' }],
  },
  {
    group: 'Blood chemistry',
    tests: [
      { name: 'FBS', fasting: true },
      { name: 'RBS' },
      { name: 'HbA1c' },
      { name: 'Lipid profile', fasting: true },
      { name: 'Creatinine' },
      { name: 'BUN' },
      { name: 'Uric acid' },
      { name: 'SGPT (ALT)' },
      { name: 'SGOT (AST)' },
      { name: 'Sodium' },
      { name: 'Potassium' },
      { name: 'OGTT', fasting: true },
    ],
  },
  {
    group: 'Serology and immunology',
    tests: [
      { name: 'HBsAg' },
      { name: 'Anti-HCV' },
      { name: 'Dengue NS1' },
      { name: 'Dengue IgG/IgM' },
      { name: 'Typhidot' },
      { name: 'TSH' },
      { name: 'FT4' },
    ],
  },
  {
    group: 'Imaging',
    tests: [
      { name: 'Chest X-ray (PA)' },
      { name: 'Whole abdomen ultrasound', fasting: true },
      { name: 'KUB ultrasound' },
      { name: 'Pelvic ultrasound' },
      { name: 'Transvaginal ultrasound' },
      { name: 'Breast ultrasound' },
    ],
  },
  {
    group: 'Cardiac and others',
    tests: [
      { name: '12-lead ECG' },
      { name: '2D echocardiogram' },
      { name: 'Sputum AFB / GeneXpert' },
      { name: 'Pap smear' },
    ],
  },
];

export const FASTING_TESTS = new Set(
  LAB_TEST_GROUPS.flatMap((g) => g.tests.filter((test) => test.fasting).map((test) => test.name)),
);
