# Clinic Management MVP (Philippines)

A clinic-first web app for small clinics and solo doctors in the Philippines. The core loop is
**Appointment → Check-in → Consultation → Prescription**, with SMS and email notifications. One
deployment serves many clinics, with strict data isolation between them.

> **Status: Phases 1–4 complete (foundation, multi-clinic, booking, check-in and queue, consultation and prescriptions).** See [Roadmap](#roadmap).

## Quick start

Requirements: Node 22+, pnpm 10, Docker.

```bash
cp .env.example .env
docker compose up -d          # Postgres 16, Mailpit
pnpm install
pnpm db:migrate               # creates tables, RLS policies, grants
pnpm db:seed                  # demo clinic (wipes existing data; refuses in production)
pnpm dev                      # API on :3000, web on :5173
```

Open http://localhost:5173 and sign in with a seed account:

| Account                        | Password             | What it shows                                                                         |
| ------------------------------ | -------------------- | ------------------------------------------------------------------------------------- |
| `doctor@sample.clinic`         | `DemoDoctor#2026`    | Admin + doctor at Sample Family Clinic, doctor at Imus: picks a clinic, then switches |
| `doctor2@sample.clinic`        | `DemoDoctor#2026`    | Second doctor at Sample Family Clinic                                                 |
| `doctor3@sample.clinic`        | `DemoDoctor#2026`    | Third doctor at Sample Family Clinic                                                  |
| `solo@sample.clinic`           | `DemoDoctor#2026`    | Solo practice: one doctor, no secretary, runs the front desk                          |
| `secretary@sample.clinic`      | `DemoSecretary#2026` | Secretary at Sample Family Clinic                                                     |
| `imus.secretary@sample.clinic` | `DemoSecretary#2026` | Admin + secretary at Sample Imus Clinic                                               |
| `platform@sample.clinic`       | `DemoPlatform#2026`  | Platform console: all clinics, no patient data                                        |

Mailpit's inbox is at http://localhost:8025 (used from Phase 5).

Patient-facing pages (no login): the booking page at http://localhost:5173/c/sample-family-clinic,
cancel links at `/cancel/<token>` (shown after booking) and the privacy notice at `/privacy`.

### Seed data

- **Sample Family Clinic**, Dasmariñas, Cavite (`/c/sample-family-clinic`): Dr. Santos (admin and
  doctor, Mon–Sat 08:00–12:00 and 13:00–17:00, 15-minute slots), Dr. Cruz (Mon/Wed/Fri afternoons,
  20-minute slots) and one secretary. 20 clearly fake patients (`+63917000xxxx`), today's
  appointments in mixed statuses, 7 finished visits with prescriptions and 3 Rx favorites.
- **Sample Family Clinic** also has Dr. Lim (OB-GYN, Tue/Thu 09:00–15:00, 30-minute slots), so
  it shows three doctors sharing one secretary.
- **Sample Solo Practice**, Gen. Trias (`/c/sample-solo-practice`): one admin-doctor and no
  secretary. The doctor checks patients in and runs the queue alone.
- **Sample Imus Clinic** (`/c/sample-imus-clinic`): Dr. Santos again, as a doctor only (Tue/Thu
  afternoons), its own admin-secretary and 3 patients. Its patients are separate from Dasmariñas.
- 56 common generic drugs (shared reference data) and a platform admin.

### Clinics and platform admins

New clinics are created in the **platform console** (`/platform`) by a platform admin. If the clinic
admin's email already has an account (for example, a doctor who practices elsewhere), that account
is reused; otherwise a one-time temporary password is shown.

Bootstrap the first platform admin from the command line (prints a one-time password):

```bash
pnpm platform:admin --name "Your Name" --email you@example.com
```

## Scripts

| Command              | What it does                                            |
| -------------------- | ------------------------------------------------------- |
| `pnpm dev`           | API (tsx watch) and web (Vite) together                 |
| `pnpm build`         | Builds every package (`apps/api/dist`, `apps/web/dist`) |
| `pnpm test`          | Unit tests (shared) and API integration tests           |
| `pnpm typecheck`     | `tsc` in every package                                  |
| `pnpm lint`          | ESLint across the repo                                  |
| `pnpm format`        | Prettier                                                |
| `pnpm db:generate`   | Generate a Drizzle migration from schema changes        |
| `pnpm db:migrate`    | Apply migrations (uses `MIGRATION_DATABASE_URL`)        |
| `pnpm db:seed`       | Reset the database to the demo clinic                   |
| `pnpm clinic:create` | Provision a new clinic and its first admin              |

Production: `pnpm build`, then `node apps/api/dist/db/migrate.js` and `node apps/api/dist/server.js`.
Serve `apps/web/dist` as static files with `/api` reverse-proxied to the API on the same origin.

API integration tests need Postgres. They migrate and use `TEST_MIGRATION_DATABASE_URL` /
`TEST_DATABASE_URL` (the `clinic_test` database created by `infra/postgres/init.sql`).

## Environment variables

Every variable is documented in [`.env.example`](.env.example). The important ones:

- `DATABASE_URL` — runtime connection. **Must be the `clinic_app` role**, which is not a superuser
  and not the table owner, so row-level security applies.
- `MIGRATION_DATABASE_URL` — owner connection, used only by migrate, seed and `platform:admin`.
- `WEB_ORIGIN` / `PUBLIC_APP_URL` — the only origins allowed by CORS and the CSRF origin check.
- `COOKIE_SECURE` — must be `true` in production (the API refuses to start otherwise).

## Architecture

```
apps/
  api/        Fastify + Drizzle (Postgres). Modules in src/modules/<area>/{routes,service}.ts
  web/        React + Vite, React Router, TanStack Query, React Hook Form, Tailwind, shadcn-style UI
packages/
  shared/     Zod schemas, types, constants, permissions, PH phone and age helpers
infra/        docker init SQL
```

The same Zod schemas validate forms in the browser and requests in the API
(`fastify-type-provider-zod`). Response schemas are also enforced, so a route cannot leak a column
it did not declare.

### Clinics, people and memberships

- A **user** is a person's login (global, one per email).
- A **membership** gives a user roles in one clinic. One person can be admin and doctor in one
  clinic and doctor only in another. Any staffing works: one doctor and one secretary, two doctors
  sharing a secretary, and so on.
- After sign-in, a user with one clinic goes straight in; a user with several picks one and can
  switch from the sidebar. Every request runs against the **active clinic**, and switching clears
  all cached data in the browser.
- **Secretary assignments** (optional) limit a secretary to specific doctors. No assignment means
  the secretary handles every doctor. The session exposes `assignedDoctorIds` for the queue and
  calendar screens.
- **Doctor credentials are per clinic** (`doctor_profiles` per clinic and user), because the PTR
  number is issued by the city where the doctor practices.
- Patients always belong to one clinic. A doctor at two clinics sees two separate patient lists:
  each clinic controls its own records under the Data Privacy Act.

### Tenant isolation (two layers)

1. **Scoped data access.** Routes never touch the database directly; they call
   `request.tenant(fn)`, which opens a transaction bound to the active clinic and hands `fn` a
   `TenantScope`. `scope.where(table, …)` always adds `clinic_id = <current clinic>` and
   `scope.values(…)` stamps `clinic_id` on inserts.
2. **Postgres row-level security as a backstop.** The transaction sets `app.clinic_id` and
   `app.user_id`. Every tenant table hides and rejects rows of any other clinic for the
   `clinic_app` role. Logins are visible only to the user and to clinics they belong to. A query
   that forgets its filter still sees only its own clinic; with no context, it sees nothing. The
   only cross-tenant lookups are two narrow functions used by sign-in and "add staff by email".

`apps/api/test/tenant-isolation.test.ts` and `multi-clinic.test.ts` prove both layers.

**When you add a tenant table**, add a migration that enables RLS and creates the
`tenant_isolation` policy for it (see `drizzle/0001_security.sql`).

### Platform console without patient access

Platform requests run with `SET LOCAL ROLE clinic_platform`. That database role has grants only on
`clinics`, `memberships`, `doctor_profiles`, non-secret `users` columns and insert-only
`audit_logs`; it has **no grants on any patient, visit or prescription table**, and patient counts
come from a function that returns numbers only. `apps/api/test/platform.test.ts` checks that the
role cannot read patients or password hashes. Suspending a clinic signs its staff out of it
immediately.

### Booking and scheduling

- A doctor's **weekly hours** are blocks per weekday (start, end, slot length, optional cap).
  **Exceptions** close a date or replace its hours (holidays, leave).
- **Slots** are generated by one pure function (`packages/shared/src/slots.ts`, unit-tested):
  weekly blocks for that weekday → exception override → minus existing active bookings → minus
  full blocks → minus anything inside the lead time. Times are computed in the clinic timezone and
  stored in UTC.
- **Public booking** (`/c/:slug`) offers the next 30 days with a 60-minute lead time
  (`PUBLIC_BOOKING_DAYS_AHEAD`, `PUBLIC_BOOKING_LEAD_MINUTES` in `packages/shared`). Only doctors
  with published hours are listed. Returning patients are matched by mobile number and birthdate;
  otherwise a patient record is created with the consent timestamp and SMS choice.
- **No double-booking, two ways:** each booking takes a per-doctor-per-day advisory lock and
  re-checks the slot, and a Postgres exclusion constraint rejects any overlap that gets through.
  A test fires two simultaneous bookings for the same slot and expects exactly one to succeed.
- **Bot protection:** a hidden honeypot field, per-IP rate limits on public writes
  (`PUBLIC_WRITE_RATE_LIMIT_PER_MINUTE`, default 5/min) and reads (60/min), and server-side slot
  validation.
- **Cancel links** carry a random token; only its SHA-256 is stored. Opening the link shows the
  clinic, doctor, time and reference code (no patient details). Cancelling is allowed only for
  booked appointments that have not started.
- **Staff calendar:** day view (one column per doctor with appointments and open slots) and week
  view. Staff can book any open slot for an existing or new patient, move a booked appointment to
  another open slot, cancel it, or mark it a no-show after its start time. Secretaries assigned to
  specific doctors only see and book those doctors.

### Any number of doctors

Nothing assumes a doctor count. Every screen adapts:

- **1 doctor:** the public page skips the doctor step; Today, Calendar, walk-ins and Settings show
  no doctor pickers. Doctors can use Today (check-in, walk-ins, vitals), so a solo practice with
  no secretary works end to end.
- **2 or more:** a doctor step on the booking page, an "All doctors" filter on Today and Calendar,
  one calendar column per doctor, a doctor picker for walk-ins (defaulting to yourself if you are
  a doctor) and in Settings, and optional secretary-to-doctor assignments in Staff.
- Each doctor has their own schedule, slots, queue numbering (starting at 1 each day) and
  "Call next". `apps/api/test/clinic-sizes.test.ts` runs the whole flow (public booking, calendar,
  check-in, walk-in, queue, call next) for clinics with 1, 2 and 5 doctors.

### Check-in and live queue

- **Today** (secretary home; doctors can use it too): today's appointments grouped into waiting, in consult, upcoming,
  done and cancelled/no-show, with counts. Check in a booked patient (confirm birthdate, sex,
  allergies and conditions; record vitals) or add a walk-in. Late patients can be marked no-show.
- **Queue numbers** are per doctor per day, assigned under the doctor-day lock and backed by a
  unique index; a concurrency test checks four simultaneous check-ins get 1–4.
- **Vitals** (BP, temperature, heart and respiratory rate, weight, height, O₂ saturation) are
  validated against plausible ranges and stored on the visit. Queue and vitals endpoints select
  only vitals columns, so secretaries never receive SOAP notes; vitals lock with the visit.
- **Doctor queue**: patients in queue order with age, sex, allergies (red) and vitals; "Call next"
  takes the lowest number (row-locked so two clicks cannot call the same patient), "Call" picks a
  specific patient, and "Return to queue" undoes a call.
- **Live updates** use Postgres `LISTEN/NOTIFY` and Server-Sent Events. Every appointment change
  runs `pg_notify` inside its transaction, so the event fires only on commit and reaches every API
  instance. `/api/events` streams to signed-in staff of that clinic only (and only for their
  assigned doctors). Events carry ids, never patient data; screens refetch. Streams send a
  heartbeat every 25 s and close after 30 minutes so the browser reconnects and the session is
  re-checked. The sidebar shows a live/reconnecting indicator.

### Consultation and prescriptions

- **Consultation screen** (`/consult/:appointmentId`, tablet-friendly): patient summary with age,
  sex, **allergies in red**, conditions and past visits; today's vitals (editable); SOAP notes
  with per-doctor templates; prescription builder; follow-up date with an optional booked slot.
  "Call next" opens it directly. Drafts autosave 1.5 s after the last change and survive reloads;
  **Ctrl/Cmd + Enter** finishes the visit.
- **Prescription builder:** typeahead over the drug list (generic or brand; arrow keys + Enter),
  free-text fallback, per-doctor favorites (apply or save), and a non-blocking **allergy warning**
  that must be acknowledged. Matching (`packages/shared/src/allergy.ts`) covers exact names,
  combination products, drug classes (penicillin → amoxicillin/co-amoxiclav, sulfa →
  cotrimoxazole, NSAIDs, cephalosporins, macrolides, quinolones…) and near-spellings. The server
  re-checks and returns `409 ALLERGY_WARNING` if unacknowledged; acknowledgement is audited.
- **Finish visit** is one transaction: notes and vitals saved, prescription and items created,
  follow-up appointment booked (if a slot was chosen), appointment marked done, visit locked,
  draft cleared, queue updated live. The PDF is rendered right after commit (and re-rendered on
  demand if missing), so a PDF problem never loses a visit.
- **Rx PDF** (A5, pdfkit): doctor name and specialty, clinic name, address and contact; patient
  name, age, sex, address and date; items with the **generic name first** and brand in
  parentheses, strength, form, quantity and sig; signature line with PRC, PTR and (if present) S2
  numbers. Credentials are edited in Settings → Doctor credentials (admins) and are per clinic.
- **Files** go through a storage interface (`apps/api/src/lib/storage.ts`); this MVP ships the
  local-disk driver (`STORAGE_DIR`). PDFs are never public: they are streamed by
  `/api/prescriptions/:id/pdf` (doctors) or by a share link.
- **Share links** (`/rx/:token`): random token, only its hash stored, valid 14 days. The page
  shows only the clinic name and dates until the patient enters their birthdate; five wrong
  birthdates disable the link. Every open and every denial is audited.
- **Amendments:** a finished visit is read-only. Its doctor can amend a SOAP field or the
  follow-up date with a required reason; the old value, new value, reason, author and time are
  stored in `visit_amendments`, shown on the visit, and audited.
- **Access:** secretaries cannot open consultations, SOAP notes, prescriptions or PDFs (API
  returns 403; the UI shows "not found"). Any doctor in the clinic can read a visit; only the
  consulting doctor can edit or amend it. The app's database role cannot delete visits or
  prescriptions.

### Auth and sessions

- argon2id password hashes; constant-time handling for unknown emails.
- Opaque session token in an httpOnly, `SameSite=Lax` cookie (`__Host-` prefixed and `Secure` in
  production). Only its SHA-256 is stored in `sessions`. Sessions are rotated on sign-in, slide on
  activity (`SESSION_IDLE_MINUTES`) and are revoked when a user is deactivated or their roles change.
- Account lockout after `LOGIN_MAX_FAILURES` failures for `LOGIN_LOCK_MINUTES`; sign-in is also
  rate-limited per IP.
- CSRF: unsafe requests must come from an allowed `Origin`, and signed-in requests must echo the
  per-session `x-csrf-token`.

### Roles and permissions

A membership holds one or more roles, so a doctor can also be an admin. Permissions are
defined once in `packages/shared/src/permissions.ts` and used by both API guards and navigation.

| Permission             | Secretary | Doctor | Admin |
| ---------------------- | :-------: | :----: | :---: |
| patients (read)        |     ✓     |   ✓    |   ✓   |
| patients (write)       |     ✓     |   ✓    |       |
| appointments, queue    |     ✓     |   ✓    |  ✓¹   |
| vitals                 |     ✓     |   ✓    |       |
| SOAP notes, Rx         |           |   ✓    |       |
| settings, staff, audit |           |        |   ✓   |

¹ Admin manages appointments only.

### Audit log and privacy

- Every view and change of patient records is written to `audit_logs` in the same transaction.
  Metadata records which fields changed, never their values. The application role can only insert
  and read audit rows (no update or delete).
- Request logs contain method, path without query string, status and timing. Cookies and CSRF
  headers are redacted. Unexpected errors are logged without database `detail` (which can contain
  row values), and clients get a generic message.
- Errors always use `{ error: { code, message, details? } }`.
- Security headers via `@fastify/helmet`, strict CORS, `Cache-Control: no-store` on API responses.

### Time and locale

Timestamps are stored in UTC (`timestamptz`) and shown in Asia/Manila. Phone numbers are accepted
as `09XXXXXXXXX` or `+639XXXXXXXXX` and stored as E.164. All UI copy lives in
`apps/web/src/i18n/en.ts` so a Filipino translation can be added alongside it.

## Design decisions

- **Memberships instead of `users.clinic_id`/`users.role`**, so one login can work in several
  clinics with different roles in each.
- **Every tenant-owned table has `clinic_id`**, including child tables such as `visits` and
  `prescription_items`, so RLS can apply uniformly. `clinics` has a unique `slug` for public URLs.
- **No double-booking** is enforced by a Postgres exclusion constraint on each doctor's active
  scheduled appointments (`btree_gist`); walk-ins are excluded.
- **`schedules.max_patients`** caps scheduled appointments within one block (e.g. "max 15 in the
  morning session"); slots are one patient each. Walk-ins do not count against it.
- **No Redis.** Notification jobs (Phase 5) will use pg-boss, a Postgres-backed queue, so a job is
  enqueued in the same transaction as the change that caused it and there is one less service to
  run. Rate limiting is in-memory per API instance (limits multiply with instance count).
- **Rx PDFs will be rendered after the finish-visit transaction commits** (and re-rendered on
  demand if missing), not inside it, so a slow render never holds database locks.

## Roadmap

| Phase | Scope                                                                              | Status  |
| ----- | ---------------------------------------------------------------------------------- | ------- |
| 1     | Monorepo, schema, auth, RBAC, tenant scoping, audit, app shell                     | Done    |
| 1.5   | Multi-clinic memberships, clinic switcher, platform console, secretary assignments | Done    |
| 2     | Schedules, slot generation, public booking, staff calendar, cancel links           | Done    |
| 3     | Today dashboard, check-in with vitals, SSE queue                                   | Done    |
| 4     | Consultation, SOAP, prescriptions, PDF, share links, amendments                    | Done    |
| 5     | Notifications: pg-boss worker, SMS/email adapters, reminders, opt-out              | Next    |
| 6     | Hardening, Playwright happy path, Google Cloud deployment                          | Planned |

Settings covers doctor schedules and credentials; the clinic profile, logo and signature images,
and notification templates follow in Phase 5. A Cloud Storage driver for files is planned with
the Phase 6 deployment work. Booking confirmations and reminders by SMS/email arrive in Phase 5; until then the
confirmation screen shows the reference code and cancel link.

## Hosting plan (Google Cloud)

- **Web:** Firebase Hosting serving `apps/web/dist`, with `/api/**` rewritten to the API so cookies
  stay same-origin.
- **API and worker:** Cloud Run (scales to zero).
- **Database:** Cloud SQL for PostgreSQL 16+ in `asia-southeast1` (Singapore). Run migrations with
  the instance's owner user; create the `clinic_app` login (`CREATE ROLE clinic_app LOGIN PASSWORD
'…'`) before the first migration. The migration creates `clinic_platform` itself.
- **Files (logos, signatures, PDFs):** Cloud Storage, private bucket, served only through the API.

Deployment files arrive in Phase 6.
