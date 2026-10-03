# Clinic Management MVP (Philippines)

A clinic-first web app for small clinics and solo doctors in the Philippines. The core loop is
**Appointment → Check-in → Consultation → Prescription**, with SMS and email notifications. One
deployment serves many clinics, with strict data isolation between them.

> **Status: Phase 1 (Foundation) complete.** See [Roadmap](#roadmap) for what is built so far.

## Quick start

Requirements: Node 22+, pnpm 10, Docker.

```bash
cp .env.example .env
docker compose up -d          # Postgres 16, Redis 7, Mailpit
pnpm install
pnpm db:migrate               # creates tables, RLS policies, grants
pnpm db:seed                  # demo clinic (wipes existing data; refuses in production)
pnpm dev                      # API on :3000, web on :5173
```

Open http://localhost:5173 and sign in with a seed account:

| Role           | Email                     | Password             |
| -------------- | ------------------------- | -------------------- |
| Admin + Doctor | `doctor@sample.clinic`    | `DemoDoctor#2026`    |
| Secretary      | `secretary@sample.clinic` | `DemoSecretary#2026` |

Mailpit's inbox is at http://localhost:8025 (used from Phase 5).

### Seed data

"Sample Family Clinic" in Dasmariñas, Cavite (`/c/sample-family-clinic`): one admin-doctor, one
secretary, Mon–Sat schedules (08:00–12:00 and 13:00–17:00, 15-minute slots), 20 clearly fake
patients (`+63917000xxxx`), today's appointments in mixed statuses, 7 finished visits with
prescriptions, 56 common generic drugs and 3 Rx favorites.

### Creating another clinic

There is no self-serve sign-up yet. Provision a tenant from the command line; it prints a one-time
password for the first admin:

```bash
pnpm clinic:create --name "Dela Paz Clinic" --slug dela-paz \
  --admin-name "Jo Dela Paz, MD" --admin-email jo@example.com --doctor --prc-no 0123456
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
- `MIGRATION_DATABASE_URL` — owner connection, used only by migrate, seed and `clinic:create`.
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

### Tenant isolation (two layers)

1. **Scoped data access.** Routes never touch the database directly; they call
   `request.tenant(fn)`, which opens a transaction bound to the signed-in user's clinic and hands
   `fn` a `TenantScope`. `scope.where(table, …)` always adds `clinic_id = <current clinic>` and
   `scope.values(…)` stamps `clinic_id` on inserts.
2. **Postgres row-level security as a backstop.** The transaction sets `app.clinic_id`, and every
   tenant table has a policy that hides and rejects rows of any other clinic for the `clinic_app`
   role. A query that forgets its filter still sees only its own clinic; with no tenant set, it
   sees nothing. The only cross-tenant read is the `auth_lookup_user()` function used by sign-in.

`apps/api/test/tenant-isolation.test.ts` proves both layers.

**When you add a tenant table**, add a migration that enables RLS and creates the
`tenant_isolation` policy for it (see `drizzle/0001_security.sql`).

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

A user holds one or more roles (`users.roles`), so a doctor can also be an admin. Permissions are
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

- **Roles are an array** instead of a single enum, so one account can be both admin and doctor.
- **Every tenant-owned table has `clinic_id`**, including child tables such as `visits` and
  `prescription_items`, so RLS can apply uniformly. `clinics` has a unique `slug` for public URLs.
- **No double-booking** is enforced by a Postgres exclusion constraint on each doctor's active
  scheduled appointments (`btree_gist`); walk-ins are excluded.
- **`schedules.max_patients`** is a daily cap per doctor per weekday; slots are one patient each.
- **Rx PDFs will be rendered after the finish-visit transaction commits** (and re-rendered on
  demand if missing), not inside it, so a slow render never holds database locks.

## Roadmap

| Phase | Scope                                                                    | Status  |
| ----- | ------------------------------------------------------------------------ | ------- |
| 1     | Monorepo, schema, auth, RBAC, tenant scoping, audit, app shell           | Done    |
| 2     | Schedules, slot generation, public booking, staff calendar, cancel links | Next    |
| 3     | Today dashboard, check-in with vitals, SSE queue                         | Planned |
| 4     | Consultation, SOAP, prescriptions, PDF, share links, amendments          | Planned |
| 5     | Notifications: BullMQ worker, SMS/email adapters, reminders, opt-out     | Planned |
| 6     | Hardening: isolation tests per route, Playwright happy path, README      | Planned |

Pages for Today, Queue, Calendar and Settings show a "not available yet" state until their phase
lands. The Redis service is used for rate limiting now (`RATE_LIMIT_USE_REDIS=true`) and for the
notification worker in Phase 5.
