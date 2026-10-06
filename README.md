# Clinic Management MVP (Philippines)

A clinic-first web app for small clinics and solo doctors in the Philippines. The core loop is
**Appointment → Check-in → Consultation → Prescription**, with SMS and email notifications. One
deployment serves many clinics, with strict data isolation between them.

- **Patients** book on a mobile-friendly public page, get SMS/email confirmations and reminders,
  cancel with a link, and open their prescription with their birthdate. No login.
- **Secretaries** run the day: calendar, check-in with vitals, walk-ins, live queue.
- **Doctors** see their queue, write SOAP notes, prescribe (with allergy checks) and print an A5
  prescription in a couple of minutes.
- **Clinic admins** manage the clinic profile, staff, schedules, credentials and message templates.
- **Platform admins** create and suspend clinics without any access to patient data.

## Contents

- [Quick start](#quick-start) · [Demo accounts](#demo-accounts) · [Scripts](#scripts) ·
  [Tests](#tests) · [Configuration](#configuration) · [Deployment](#deployment)
- [Architecture](#architecture) · [Features](#features) · [Security and privacy](#security-and-privacy)
  · [Design decisions](#design-decisions) · [Known limitations](#known-limitations)

## Quick start

Requirements: Node 22.12+, pnpm 10, Docker.

```bash
cp .env.example .env
docker compose up -d          # Postgres 16 and Mailpit
pnpm install
pnpm db:migrate               # tables, row-level security, grants
pnpm db:seed                  # demo data (wipes the database; refuses in production)
pnpm dev                      # API :3000, web :5173, notification worker
```

Open http://localhost:5173 and sign in with a demo account. Emails land in Mailpit
(http://localhost:8025); with `SMS_PROVIDER=console`, text messages are printed by the worker.

Patient pages need no login: booking at http://localhost:5173/c/sample-family-clinic, plus the
cancel (`/cancel/…`), prescription (`/rx/…`) and opt-out (`/u/…`) links sent in messages, and the
privacy notice at `/privacy`.

## Demo accounts

| Account                        | Password             | What it shows                                                                         |
| ------------------------------ | -------------------- | ------------------------------------------------------------------------------------- |
| `doctor@sample.clinic`         | `DemoDoctor#2026`    | Admin + doctor at Sample Family Clinic, doctor at Imus: picks a clinic, then switches |
| `doctor2@sample.clinic`        | `DemoDoctor#2026`    | Second doctor at Sample Family Clinic                                                 |
| `doctor3@sample.clinic`        | `DemoDoctor#2026`    | Third doctor at Sample Family Clinic                                                  |
| `solo@sample.clinic`           | `DemoDoctor#2026`    | Solo practice: one doctor, no secretary, runs the front desk                          |
| `secretary@sample.clinic`      | `DemoSecretary#2026` | Secretary at Sample Family Clinic                                                     |
| `imus.secretary@sample.clinic` | `DemoSecretary#2026` | Admin + secretary at Sample Imus Clinic                                               |
| `platform@sample.clinic`       | `DemoPlatform#2026`  | Platform console: all clinics, no patient data                                        |

Seed data (all names and numbers are fake):

- **Sample Family Clinic**, Dasmariñas, Cavite (`/c/sample-family-clinic`): three doctors sharing
  one secretary. Dr. Santos (admin, Mon–Sat 08:00–12:00 and 13:00–17:00, 15-minute slots),
  Dr. Cruz (Mon/Wed/Fri afternoons, 20-minute slots) and Dr. Lim (Tue/Thu 09:00–15:00,
  30-minute slots). 20 patients, today's appointments in every status, 7 finished visits with
  prescriptions, 3 Rx favorites and default message templates.
- **Sample Imus Clinic** (`/c/sample-imus-clinic`): Dr. Santos again, as a doctor only, with its
  own admin-secretary and patients. Its records are separate from Dasmariñas.
- **Sample Solo Practice**, Gen. Trias (`/c/sample-solo-practice`): one admin-doctor and no
  secretary.
- 56 common generic drugs (shared reference list) and a platform admin.

New clinics are created by a platform admin in the platform console (`/platform`). Create the
first platform admin from the command line (prints a one-time password):

```bash
pnpm platform:admin --name "Your Name" --email you@example.com
```

## Scripts

| Command               | What it does                                                            |
| --------------------- | ----------------------------------------------------------------------- |
| `pnpm dev`            | API, notification worker and web (Vite) together                        |
| `pnpm worker`         | Notification worker only                                                |
| `pnpm build`          | Builds `apps/api/dist` (API, worker, migrate, seed) and `apps/web/dist` |
| `pnpm test`           | Unit tests (shared) and API integration tests                           |
| `pnpm test:e2e`       | Playwright end-to-end test (starts its own servers and database)        |
| `pnpm typecheck`      | `tsc` in every package                                                  |
| `pnpm lint`           | ESLint                                                                  |
| `pnpm format`         | Prettier                                                                |
| `pnpm db:generate`    | Generate a Drizzle migration from schema changes                        |
| `pnpm db:migrate`     | Apply migrations (`MIGRATION_DATABASE_URL`)                             |
| `pnpm db:seed`        | Reset the database to the demo data                                     |
| `pnpm platform:admin` | Create (or promote) a platform admin                                    |

## Tests

- **`pnpm test`** runs 156 unit and integration tests (35 in `packages/shared`, 121 in `apps/api`). Integration tests use the `clinic_test`
  database (`TEST_DATABASE_URL` / `TEST_MIGRATION_DATABASE_URL`) with in-memory SMS and email.
  Highlights:
  - `route-security.test.ts`: every route must be classified as public, session-only or
    clinic-scoped (an unclassified route fails the build). Anonymous calls to every non-public
    route get 401. Clinic B's admin-doctor then calls **all 61 clinic-scoped routes** with clinic
    A's real record ids and valid bodies; nothing succeeds or leaks, and clinic A is verified
    unchanged. Also checks security headers and CORS.
  - `tenant-isolation.test.ts`, `multi-clinic.test.ts`, `platform.test.ts`: the database layer
    (row-level security, the platform role without patient access).
  - `clinic-sizes.test.ts`: the whole flow for clinics with 1, 2 and 5 doctors.
  - `booking.test.ts`, `queue.test.ts`: concurrent double-booking and queue numbering.
  - `consult.test.ts`, `notifications.test.ts`: allergy warnings, PDF content, share links,
    amendments, message privacy, retries, opt-out, and one run through pg-boss.
  - `referrals.test.ts`: specialty matching, who may refer, decline and cancel, front-desk
    booking without clinical details, the letter's content, and status following the appointment.
- **`pnpm test:e2e`** (Playwright): a patient books on a phone, the secretary checks them in with
  vitals, the doctor calls them, writes notes and a prescription and finishes the visit, the PDF
  downloads, and the patient opens the share link with their birthdate. The doctor then refers
  the patient to the clinic's OB-GYN, and the secretary books the referral. It uses the `clinic_e2e`
  database (`E2E_DATABASE_URL`, `E2E_MIGRATION_DATABASE_URL`), reseeds it, and starts the API and
  web app on ports 3100 and 5180. Run `pnpm exec playwright install chromium` once, or set
  `PLAYWRIGHT_CHROMIUM_EXECUTABLE`.

## Configuration

Every variable is documented in [`.env.example`](.env.example). The ones that matter most:

| Variable                               | Purpose                                                              |
| -------------------------------------- | -------------------------------------------------------------------- |
| `DATABASE_URL`                         | Runtime connection as `clinic_app` (never the owner, so RLS applies) |
| `MIGRATION_DATABASE_URL`               | Owner connection for migrations, seed and `platform:admin`           |
| `JOBS_DATABASE_URL`                    | Worker only: pg-boss queue (role that can own the `pgboss` schema)   |
| `TOKEN_SECRET`                         | Signs cancel and opt-out links (32+ characters)                      |
| `WEB_ORIGIN`, `PUBLIC_APP_URL`         | Allowed origin for CORS/CSRF; base URL for links in messages         |
| `COOKIE_SECURE`, `SESSION_COOKIE_NAME` | Secure cookies in production; `__session` behind Firebase Hosting    |
| `SMS_PROVIDER`, `EMAIL_PROVIDER`       | `console`/`semaphore`, `smtp`/`resend`                               |
| `STORAGE_DRIVER`, `GCS_BUCKET`         | `local` disk in development, `gcs` in production                     |
| `PUBLIC_BOOKING_LEAD_MINUTES`          | How far ahead online bookings must be (default 60)                   |

Database URLs may use the Cloud SQL socket form
`postgres://user:pass@localhost/db?host=/cloudsql/PROJECT:REGION:INSTANCE`.

## Deployment

The target is Google Cloud: **Firebase Hosting** for the web app (with `/api/**` rewritten to
Cloud Run, so everything is same-origin), **Cloud Run** for the API and the worker (one Docker
image), **Cloud SQL for PostgreSQL 16** and a private **Cloud Storage** bucket, all in
`asia-southeast1`. Step-by-step commands are in [docs/deploy-gcp.md](docs/deploy-gcp.md);
`Dockerfile` and `firebase.json` are at the repository root.

Any other host works the same way: run `node dist/db/migrate.js`, then `node dist/server.js` and
`node dist/worker.js` from the image, and serve `apps/web/dist` with `/api` proxied to the API on
the same origin.

## Architecture

```
apps/
  api/        Fastify + Drizzle (Postgres). src/modules/<area>/{routes,service}.ts
              src/worker.ts: notification worker (pg-boss)
  web/        React + Vite, React Router, TanStack Query, React Hook Form, Tailwind, shadcn-style UI
packages/
  shared/     Zod schemas, types, permissions, slot generator, allergy matcher, templates, helpers
e2e/          Playwright end-to-end test
infra/        Docker init SQL
docs/         Deployment guide
```

The same Zod schemas validate forms in the browser and requests in the API
(`fastify-type-provider-zod`). Response schemas are enforced too, so a route cannot leak a column
it did not declare. Errors always use `{ error: { code, message, details? } }`. All UI copy is in
`apps/web/src/i18n/en.ts`, ready for a Filipino translation. Times are stored in UTC and shown in
Asia/Manila; phone numbers are stored as E.164 (`+639…`). Each page of the web app is its own
chunk, so the booking page does not download the staff app.

### Clinics, people and memberships

- A **user** is a person's login (one per email). A **membership** gives that user roles in one
  clinic, so a doctor can be admin and doctor in one clinic and doctor only in another, and
  switch between them from the sidebar. Every request runs against the active clinic; switching
  clears all cached data in the browser.
- Any staffing works: a solo doctor running the front desk, one doctor and one secretary, several
  doctors sharing secretaries. **Secretary assignments** (optional) limit a secretary to specific
  doctors. Screens show doctor pickers only when there is more than one doctor.
- **Doctor credentials are per clinic** (the PTR number depends on the city).
- Patients always belong to one clinic: each clinic controls its own records under the Data
  Privacy Act.

### Tenant isolation (two layers)

1. **Scoped data access.** Routes use `request.tenant(fn)`, a transaction bound to the active
   clinic. `scope.where(table, …)` always adds `clinic_id = <clinic>`; `scope.values(…)` stamps it
   on inserts.
2. **Postgres row-level security as a backstop.** The transaction sets `app.clinic_id` and
   `app.user_id`; every tenant table hides and rejects other clinics' rows for the `clinic_app`
   role. A query that forgets its filter still sees only its own clinic; with no context it sees
   nothing. The few cross-tenant lookups (sign-in, cancel and share links, the outbox relay,
   opt-out) are narrow `SECURITY DEFINER` functions that return ids only.

**When you add a tenant table**, add a migration that enables RLS with a `tenant_isolation`
policy (see `drizzle/0001_security.sql`), and classify any new route in
`route-security.test.ts`.

The **platform console** runs as the `clinic_platform` database role, which has no grants on any
patient, visit or prescription table; patient counts come from a function that returns numbers
only.

## Features

### Booking and scheduling

- Weekly hours per doctor (blocks with slot length and optional patient cap) plus exceptions for
  holidays, leave or different hours on one date.
- Slots come from one pure, unit-tested function (`packages/shared/src/slots.ts`).
- **Public booking** (`/c/:slug`): doctor (if several), date, time, details, privacy consent and
  SMS opt-in, with a honeypot and per-IP rate limits. Returning patients are matched by mobile
  number and birthdate. Staff get an in-app alert (and an email if the clinic has one).
- **No double-booking:** a per-doctor-day advisory lock plus a Postgres exclusion constraint. A
  test fires two simultaneous bookings for one slot; exactly one wins.
- **Staff calendar:** day view (a column per doctor with open slots) and week view; book, move,
  cancel, mark no-show.

### Check-in and live queue

- **Today** page: waiting, in consult, upcoming, done, cancelled; check-in with profile
  completion and validated vitals; walk-ins; no-shows.
- **Queue numbers** per doctor per day, safe under concurrency.
- **Doctor queue:** queue order with age, sex, allergies in red and vitals; Call next (opens the
  consultation), Call, Return to queue.
- **Live updates:** `pg_notify` inside each change's transaction (fires only on commit, reaches
  every API instance) streamed over Server-Sent Events to that clinic's staff only. Events carry
  ids, never patient data.

### Consultation and prescriptions

- **Consultation screen** (tablet-friendly): patient summary and past visits, editable vitals,
  SOAP notes with per-doctor templates, prescription builder, follow-up date with optional
  booking. Drafts autosave; **Ctrl/Cmd + Enter** finishes.
- **Prescription builder:** drug typeahead with free-text fallback, favorites, and a non-blocking
  **allergy warning** (names, combination drugs, drug classes, misspellings) that must be
  acknowledged; the server re-checks and audits it.
- **Finish visit** is one transaction: notes, vitals, prescription, follow-up, status, lock. The
  PDF is rendered after commit.
- **A5 PDF:** logo, doctor and clinic header, patient name/age/sex/address/date, generic name
  first with brand in parentheses, quantity and sig, optional signature image, PRC/PTR/S2.
- **Share links** (14 days, birthdate check, disabled after 5 wrong tries, every access audited)
  and **amendments** to finished visits (old value, new value, reason, author).

### Referrals by specialty

- From an open or finished visit, the doctor picks a **specialty** (one shared list, also used
  for doctor profiles), then a doctor in this clinic listed under it, or a specialist **outside
  the clinic** (optional doctor and hospital names). With one matching colleague, they are
  preselected; with none, the referral goes outside. Urgency: routine, urgent or emergency.
- The **clinical summary** is prefilled from the visit notes and printed on an **A4 referral
  letter** (letterhead, addressee, patient, allergies, reason, summary, current medicines,
  signature and PRC).
- In-clinic referrals land in **Referrals → To book** for the front desk (emergencies first).
  Secretaries see the specialty, urgency and patient, but not the reason or summary. Booking
  creates the appointment with the receiving doctor and sends the usual confirmation.
- The receiving doctor sees **Referred to me**, can decline with a note, and gets a banner with
  the reason and summary on the referred consultation. The sender can cancel until it is booked.
- Status follows the appointment through a database trigger, whatever path changes it:
  finished → _seen_; cancelled or no-show → back to _to book_.

### Notifications

```
change ──(same transaction)──▶ outbox ──▶ worker relay ──▶ pg-boss (3 retries, backoff)
                                                              ▼
              template ▶ still valid? opted in? ▶ SMS / email adapter ▶ notification_logs
```

- Booking confirmation, moved, cancelled, reminders (6 PM the day before, 7 AM the same day),
  after-visit prescription link, follow-up reminder, staff booking alert.
- Moving, cancelling or checking in removes pending reminders in the same transaction.
- Per-channel log (`queued | sent | failed | skipped`); retries never re-send a channel.
- Adapters: Semaphore or console SMS; SMTP (Mailpit) or Resend email.
- Templates per clinic with a fixed list of variables and **no variable for the reason,
  diagnosis or medicines**; editable in Settings with a preview and SMS part counter.
- Opt-out link in every SMS, and STOP replies through `POST /api/webhooks/sms/inbound`.

### Settings

Clinic profile and logo, doctor schedules and exceptions, doctor credentials (specialty, PRC,
PTR, S2) and signature,
staff and roles, message templates and log. Rx favorites and SOAP templates are managed from the
consultation screen.

## Security and privacy

Health data is sensitive personal information under the Data Privacy Act of 2012.

- **Private by default:** every route requires a session unless explicitly marked public; the
  check runs before validation. Role permissions live in `packages/shared/src/permissions.ts`.
  Secretaries see demographics, vitals and appointments, never SOAP notes or prescriptions.

  | Permission             | Secretary | Doctor | Admin |
  | ---------------------- | :-------: | :----: | :---: |
  | patients (read)        |     ✓     |   ✓    |   ✓   |
  | patients (write)       |     ✓     |   ✓    |       |
  | appointments, queue    |     ✓     |   ✓    |  ✓¹   |
  | vitals                 |     ✓     |   ✓    |       |
  | SOAP notes, Rx         |           |   ✓    |       |
  | settings, staff, audit |           |        |   ✓   |

  ¹ Admins manage appointments only. A membership can hold several roles (e.g. admin + doctor).

- **Sessions:** argon2id passwords, account lockout, per-IP sign-in rate limit, opaque session
  token in an httpOnly `SameSite=Lax` cookie (only its hash is stored), rotation on sign-in,
  idle expiry, immediate revocation on deactivation or role change.
- **CSRF:** allowed `Origin` required for unsafe requests, plus a per-session `x-csrf-token`.
- **Audit log:** every view and change of patient, visit, prescription and referral records, written in the
  same transaction; field names only, never values. The app's database role cannot update or
  delete audit rows, visits, prescriptions or referrals.
- **No PHI in logs or errors:** request logs have method, path (no query string), status and
  timing; database error details are never logged or returned.
- **Files** are private: prescriptions are served only to signed-in doctors or through a share
  link, and referral letters only to signed-in doctors; only the clinic logo is public. Uploads are checked by file signature, not just type.
- **Links in messages** (cancel, opt-out) are HMAC-signed with `TOKEN_SECRET`; share links are
  random. Only hashes are stored.
- **Headers:** HSTS, `nosniff`, `Referrer-Policy: no-referrer` (tokens in URLs never leak), CSP
  with `frame-ancestors 'none'`, `Cache-Control: no-store` on API data, strict CORS. The web app
  sends the same headers from Firebase Hosting.

## Design decisions

- **Memberships** instead of one clinic and role per user, so one login can work in several
  clinics.
- **Every tenant table has `clinic_id`**, including child tables, so RLS applies uniformly.
- **`schedules.max_patients`** caps scheduled appointments per block; walk-ins do not count.
- **No Redis:** pg-boss (a Postgres-backed queue) fed by a transactional outbox.
- **PDFs are rendered after the finish-visit transaction** (and on demand if missing), so a slow
  render never holds locks or loses a visit.
- **Cancel and opt-out links are derived from a secret** so reminders can include them without
  storing raw tokens.

## Known limitations

- **Rate limits are per API instance;** with several instances the effective limit multiplies.
- **Long SMS:** with links, some default SMS use two parts; the template editor shows the count.
- **Untested providers:** Semaphore and Resend follow their published APIs but have not been
  exercised against live accounts.
- **Docker:** the image and Firebase configuration have not been deployed from this environment
  (no Docker or cloud access here). The production bundle was run directly, and the Cloud SQL
  socket form is covered by a test.
- **Out of scope for the MVP:** online payments, video consults, HMO/PhilHealth claims, a patient
  portal login, multi-branch clinics and S2 (dangerous drug) prescriptions. The schema leaves room
  for them: `doctor_profiles.s2_no` already exists, and patients, appointments and prescriptions are
  separate tables a portal could expose.
