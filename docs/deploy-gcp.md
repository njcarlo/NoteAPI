# Deploying to Google Cloud

```
 browser ──▶ Firebase Hosting ──(/api/**)──▶ Cloud Run "clinic-api" ──▶ Cloud SQL (Postgres 16)
              static web app                 Cloud Run "clinic-worker" ─┘        │
                                             Cloud Storage (private bucket) ◀────┘
```

Everything runs in `asia-southeast1` (Singapore). One container image serves the API, the
notification worker and migrations. Commands assume the `gcloud` and `firebase` CLIs and that you
are at the repository root. Replace the `UPPER_CASE` values.

## 1. Project and services

```bash
PROJECT=your-project-id
REGION=asia-southeast1
gcloud config set project $PROJECT
gcloud services enable run.googleapis.com sqladmin.googleapis.com secretmanager.googleapis.com \
  artifactregistry.googleapis.com cloudbuild.googleapis.com storage.googleapis.com
gcloud artifacts repositories create clinic --repository-format=docker --location=$REGION
```

## 2. Database

```bash
gcloud sql instances create clinic-db --database-version=POSTGRES_16 --region=$REGION \
  --tier=db-g1-small --storage-auto-increase --backup-start-time=18:00 \
  --enable-point-in-time-recovery
gcloud sql users create clinic_owner --instance=clinic-db --password='OWNER_PASSWORD'
```

`clinic_owner` owns the database and runs migrations, seeding and the worker's queue. Users
created with `gcloud` belong to `cloudsqlsuperuser`, which can create roles and the `btree_gist`
extension that the migrations need. Connect with `gcloud sql connect clinic-db --user=postgres`
and create the database and the application role:

```sql
GRANT clinic_owner TO postgres;                 -- so postgres may create a database owned by it
CREATE DATABASE clinic OWNER clinic_owner;      -- on Postgres 16 the owner controls schema public
CREATE ROLE clinic_app LOGIN PASSWORD 'APP_PASSWORD';
```

`clinic_app` is what the API uses. It is not the table owner, so row-level security applies to
every query it runs. The first migration creates `clinic_platform` and all grants.

Connection strings (Cloud Run reaches Cloud SQL through a unix socket):

```
INSTANCE=$PROJECT:$REGION:clinic-db
DATABASE_URL=postgres://clinic_app:APP_PASSWORD@localhost/clinic?host=/cloudsql/$INSTANCE
MIGRATION_DATABASE_URL=postgres://clinic_owner:OWNER_PASSWORD@localhost/clinic?host=/cloudsql/$INSTANCE
JOBS_DATABASE_URL=postgres://clinic_owner:OWNER_PASSWORD@localhost/clinic?host=/cloudsql/$INSTANCE
```

## 3. Files and secrets

```bash
gcloud storage buckets create gs://$PROJECT-clinic-files --location=$REGION \
  --uniform-bucket-level-access --public-access-prevention

printf '%s' "postgres://clinic_app:APP_PASSWORD@localhost/clinic?host=/cloudsql/$PROJECT:$REGION:clinic-db" \
  | gcloud secrets create database-url --data-file=-
printf '%s' "postgres://clinic_owner:OWNER_PASSWORD@localhost/clinic?host=/cloudsql/$PROJECT:$REGION:clinic-db" \
  | gcloud secrets create owner-database-url --data-file=-
openssl rand -base64 48 | tr -d '\n' | gcloud secrets create token-secret --data-file=-
printf '%s' 'SEMAPHORE_KEY' | gcloud secrets create semaphore-api-key --data-file=-
printf '%s' 'RESEND_KEY' | gcloud secrets create resend-api-key --data-file=-

SA=clinic-run@$PROJECT.iam.gserviceaccount.com
gcloud iam service-accounts create clinic-run
for role in roles/cloudsql.client roles/secretmanager.secretAccessor; do
  gcloud projects add-iam-policy-binding $PROJECT --member=serviceAccount:$SA --role=$role
done
gcloud storage buckets add-iam-policy-binding gs://$PROJECT-clinic-files \
  --member=serviceAccount:$SA --role=roles/storage.objectAdmin
```

## 4. Build the image

```bash
IMAGE=$REGION-docker.pkg.dev/$PROJECT/clinic/app:$(git rev-parse --short HEAD)
gcloud builds submit --tag $IMAGE
```

## 5. Migrate

```bash
gcloud run jobs create clinic-migrate --image=$IMAGE --region=$REGION --service-account=$SA \
  --set-cloudsql-instances=$PROJECT:$REGION:clinic-db \
  --set-secrets=MIGRATION_DATABASE_URL=owner-database-url:latest,DATABASE_URL=database-url:latest,TOKEN_SECRET=token-secret:latest \
  --command=node --args=dist/db/migrate.js
gcloud run jobs execute clinic-migrate --region=$REGION --wait
```

Run the job again (with the new image: `gcloud run jobs update clinic-migrate --image=$IMAGE`)
before every deploy that adds migrations.

Create the first platform admin once, from your machine through the
[Cloud SQL Auth Proxy](https://cloud.google.com/sql/docs/postgres/sql-proxy), with
`MIGRATION_DATABASE_URL` pointing at the proxy:
`pnpm platform:admin --name "Your Name" --email you@example.com`.

## 6. Deploy the API and the worker

```bash
WEB=https://$PROJECT.web.app          # or your custom domain
COMMON="--image=$IMAGE --region=$REGION --service-account=$SA \
  --set-cloudsql-instances=$PROJECT:$REGION:clinic-db"
ENV="NODE_ENV=production,COOKIE_SECURE=true,TRUST_PROXY=true,SESSION_COOKIE_NAME=__session,\
SSE_MAX_STREAM_SECONDS=55,WEB_ORIGIN=$WEB,PUBLIC_APP_URL=$WEB,\
STORAGE_DRIVER=gcs,GCS_BUCKET=$PROJECT-clinic-files,SMS_PROVIDER=semaphore,SMS_SENDER_NAME=CLINIC,\
EMAIL_PROVIDER=resend,EMAIL_FROM=Clinic <no-reply@your-domain.ph>"
SECRETS="DATABASE_URL=database-url:latest,MIGRATION_DATABASE_URL=owner-database-url:latest,\
TOKEN_SECRET=token-secret:latest,SEMAPHORE_API_KEY=semaphore-api-key:latest,RESEND_API_KEY=resend-api-key:latest"

gcloud run deploy clinic-api $COMMON --allow-unauthenticated \
  --set-env-vars="$ENV" --set-secrets="$SECRETS" --min-instances=0 --max-instances=4

gcloud run deploy clinic-worker $COMMON --no-allow-unauthenticated \
  --set-env-vars="$ENV" --set-secrets="$SECRETS,JOBS_DATABASE_URL=owner-database-url:latest" \
  --command=node --args=dist/worker.js --no-cpu-throttling --min-instances=1 --max-instances=1
```

Why these settings:

- **`SESSION_COOKIE_NAME=__session`**: Firebase Hosting forwards only a cookie with this exact
  name to Cloud Run. Any other name and nobody can stay signed in.
- **`SSE_MAX_STREAM_SECONDS=55`**: Hosting ends requests to Cloud Run after 60 seconds. Live
  updates reconnect automatically before that.
- **`TRUST_PROXY=true`**: client IPs (rate limits, audit log) come from `X-Forwarded-For`.
- **Worker `--no-cpu-throttling --min-instances=1`**: the relay and queue need CPU between
  requests. One instance is enough for many clinics; more instances are safe (rows are claimed
  with `SKIP LOCKED` and jobs are de-duplicated).
- **Rate limits** are per API instance. With `--max-instances=4` the effective limit is up to 4×.

## 7. Deploy the web app

```bash
cp .firebaserc.example .firebaserc    # set your project id
pnpm --filter @clinic/web build
firebase deploy --only hosting
```

`firebase.json` rewrites `/api/**` to the `clinic-api` service (same origin, so the session
cookie and CSRF checks work without CORS), serves the single-page app for every other path,
caches hashed assets for a year, and sets security headers (CSP, HSTS, no framing, no referrer
so tokens in `/cancel/…`, `/rx/…` and `/u/…` links never leak to other sites).

## 8. After the first deploy

- Sign in as the platform admin, create the first clinic, and send its admin the temporary
  password.
- In the clinic: Settings → Clinic (profile, logo, email for booking alerts, SMS sender name),
  Doctor schedules, Doctor credentials, Notifications.
- If Semaphore can forward replies, point it at `https://YOUR_DOMAIN/api/webhooks/sms/inbound`
  with header `x-webhook-secret` and set `SMS_WEBHOOK_SECRET` on both services.
- Backups and point-in-time recovery are on (step 2); keep them on, this is medical data.
