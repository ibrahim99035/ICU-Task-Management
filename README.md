# ICU TaskLog

A thesis demo for ICU nurses: plan a shift by task priority, time care from stored timestamps, protect tier 1–2 work during emergencies, and build a handover from what actually happened.

> **Not a medical device.** This is a planning and logging aid for practice data. It does not replace bedside monitors, alarms, official orders or the clinical handover process. Do not enter patient names, MRNs, dates of birth or other identifiers.

## Live demo

<https://icu-tasklog.vercel.app>

The production deployment serves the Next.js app and the Hono API from the same domain. Use the demo accounts below. The APK is built from the same source and points at this URL.

## What it does

- **Nurse flow:** create an account or sign in, start a shift, see six demo beds, work a tier-sorted task queue, start/pause/finish tasks, log interruptions, quick-add a task, handle an emergency, review deferred work, finalize a handover, end the shift and read a timestamp-based summary.
- **Head-nurse flow:** unit dashboard, shift list, shift detail with event timeline, five manual 1–5 ratings, CSV export.
- **Offline-first nurse actions:** every action is written to Dexie first and pushed later through an outbox. Timers are computed from stored event timestamps, never from in-memory counters.
- **Rule-based only:** no AI/ML, no computed nurse score, no ranking or leaderboard. Tier 1–2 tasks are never auto-deferred; only planned tier 3–4 tasks are deferred during an emergency, and a nurse confirms every new time.
- **Evaluation:** SUS and raw NASA-TLX forms, plus CSV exports for analysis.

## Demo accounts

| Username | PIN | Role |
| --- | --- | --- |
| `amina` | `1111` | Nurse |
| `yara` | `2222` | Nurse |
| `omar` | `3333` | Nurse |
| `head` | `9999` | Head nurse |

The shift-start screen has a demo option that backdates the shift by two hours, so overdue and tier-ordering states are visible immediately. Turn it off for a live practice shift.

Nurses can also create their own account from the login screen. Self-registration creates **nurse accounts only**; head-nurse accounts are provisioned by the study team. There is no email recovery, and account creation requires a network connection. After the first sign-in, the normal offline nurse flow is available.

## Stack and layout

One Next.js App Router project at the repo root:

- `src/app` — nurse and head-nurse screens; `src/app/api/[[...route]]/route.ts` mounts Hono.
- `src/domain` — pure TypeScript rules and Zod event schema, with Vitest tests.
- `src/lib` — Dexie, Zustand, sync/outbox, API client, actions, formatting.
- `src/server` — Hono routes, JWT auth, role guards, CSV.
- `src/db` — Drizzle schema and Neon client.
- `scripts` — schema/seed/simulate/API-test/lint/build-mobile/UI-capture scripts.
- `resources` — Capacitor icon and splash source images.

The web app and the APK come from the same code. The APK is a static export bundled by Capacitor; it calls the deployed Vercel API over HTTPS. There is no second hosted API project.

## Local setup

Requirements: Node.js 22+, a PostgreSQL/Neon database, and (optional) Docker for the API test.

```bash
npm install
cp .env.example .env      # fill DATABASE_URL and JWT_SECRET
npm run db:push           # apply scripts/schema.sql
npm run db:seed           # users, templates, config
npm run dev
```

Open `http://localhost:3000`.

Useful commands:

```bash
npm run typecheck         # tsc --noEmit
npm test                  # 22 domain tests
npm run lint              # product-rule guard (no AI, no IDs, pure domain)
npm run build             # web production build (webpack)
npm run build:mobile      # static export for the APK
npm run simulate:reset    # deterministic 14-shift demo dataset
npm run db:reset-shifts -- --yes  # delete non-simulated UI-test shifts
npm run test:api          # disposable Docker Postgres required
npm run test:e2e          # Playwright auth/role/privacy smoke
```

### API tests

```bash
docker run -d --rm --name icu-api-test-db \
  -e POSTGRES_PASSWORD=test -e POSTGRES_DB=icu_test \
  -p 55432:5432 postgres:16-alpine

DATABASE_URL=postgres://postgres:test@localhost:55432/icu_test \
JWT_SECRET=api-test-secret \
npm run test:api

docker stop icu-api-test-db
```

The script refuses a non-local database host.

### Playwright

```bash
npm run build
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/path/to/chrome \
E2E_NO_SERVER=1 npm run test:e2e
```

If Playwright's own browser is installed, omit `PLAYWRIGHT_CHROMIUM_EXECUTABLE`. To let Playwright start the production server, omit `E2E_NO_SERVER`.

The full visual flow check is:

```bash
node scripts/flow-check.mjs
```

It creates a real shift, exercises emergency/reschedule/timer/quick-add/handover/shift-end, and writes screenshots under `/tmp/opencode/icu-capture`.

## Vercel deployment

1. Import the GitHub repository into Vercel as one Next.js project. Keep the default build command `npm run build`.
2. Set environment variables in Vercel:
   - `DATABASE_URL` — Neon pooled connection string.
   - `JWT_SECRET` — long random string.
   - `ALLOWED_ORIGINS` — e.g. `https://your-project.vercel.app,https://localhost,capacitor://localhost`.
3. Deploy. The API is served from the same domain at `/api`.
4. Apply the schema and seed from a trusted machine against the production database:

```bash
DATABASE_URL='postgresql://...' npm run db:push
DATABASE_URL='postgresql://...' npm run db:seed
```

Do not put the database URL in the repository, a screenshot or a public chat.

## Android debug APK

The APK is built by `.github/workflows/android.yml`:

1. Set the GitHub Actions repository variable `VERCEL_API_URL` to the deployed HTTPS URL (or pass `api_url` when running the workflow manually).
2. Run **Actions → Android debug APK → Run workflow**.
3. Download the `icu-tasklog-debug-apk` artifact.

The workflow installs dependencies, runs `npm run build:mobile`, adds the Android platform with Capacitor, generates icons/splash, and runs `./gradlew assembleDebug`.

The workflow has produced the debug artifact successfully. Run `43312717097` built `app-debug.apk` (5,600,362 bytes, SHA-256 `ce21231cbe455d7ca498b0185c2eacc1f236acb11795fa1ac38f84e526a3f7fe`). The artifact was downloaded and inspected as a signed Android package; installation on a physical device is still unverified.

Debug signing is automatic. The APK is for demonstration, not Play Store distribution. `NEXT_PUBLIC_API_URL` is compiled into the bundle, so rebuild after changing the deployment URL.

## Privacy and scope

- Beds are number + short free-text nickname. The UI warns against names.
- No patient records, photos, EHR integration, biometric/OAuth login, push notifications, iOS build, Arabic/RTL, admin screens, template editor UI, weighted TLX, TAM or AI.
- Head-nurse ratings are five manual criteria. No composite score or leaderboard is calculated.
- Demo task content and intervals require ICU clinical review before any real use.

See `ASSUMPTIONS.md`, `PROGRESS.md` and `EVALUATION.md` for decisions and evidence.
