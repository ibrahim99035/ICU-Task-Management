# TaskLog

A thesis demo for nurses in dynamic care units. It loads the agreed staff-nurse or head-nurse task list, lets the nurse plan future work in a **To Do** list and record past work in a **Time Log**, times care from stored timestamps, protects tier 1–2 work, rings a foreground alarm when a task reaches its planned end, and builds one shift-level handover from what actually happened. Units are not hard-coded to ICU; a head nurse creates them and assigns nurses.

> **Not a medical device.** This is a planning and logging aid for practice data. It does not replace bedside monitors, alarms, official orders or the clinical handover process. Do not enter patient names, MRNs, dates of birth or other identifiers.

## Live demo

<https://icu-tasklog.vercel.app>

The production deployment serves the Next.js app and the Hono API from the same domain. Use the demo accounts below. The APK is built from the same source and points at this URL.

## What it does

- **Dynamic units:** head nurses create or archive units, assign nurses, and filter the dashboard, shift list and exports by unit. A nurse can belong to multiple units; each shift belongs to one unit and tasks inherit it.
- **Nurse flow:** one-tap demo login or manual sign-in, choose an assigned unit at shift start, and work the exact 12-task staff-nurse list. Start/pause/finish tasks, edit an unfinished task and add a note, log interruptions, add an optional custom task, finalize one shift-level handover, end the shift and read a timestamp-based summary. There are no bed tasks or bed screens.
- **Head-nurse flow:** one-tap demo login, unit management, unit-filtered dashboard, shift list, shift detail with event timeline, edit an unfinished task or add a note, five manual 1–5 ratings, CSV export, plus a separate head-nurse shift with the exact 14-task list and its own To Do/Time Log. Head-nurse tasks are online-only and never appear in nurse analytics or exports.
- **To Do vs Time Log:** To Do is a future planned start plus duration. Time Log is a past actual interval such as 07:00–07:30. Time-only input resolves on the shift date and supports overnight intervals. A time log marks the task done and records the duration; a tick-only completion can receive a time log later.
- **Shift length limit:** a shift cannot stay open indefinitely. The limit is 16 hours (two normal 8-hour shifts). A stale nurse shift auto-ends when the app loads; a stale head-nurse shift auto-ends before the head-nurse list or a new head shift. Open tasks are marked missed at the 16-hour cap.
- **Audited task alteration:** both roles can edit unfinished task fields and notes. Each change is a `TASK_EDITED` event; completed and missed tasks are frozen.
- **Offline unit cache:** the nurse's assigned units are cached in Dexie after sync, so shift start still works offline.
- **Offline-first nurse actions:** every action is written to Dexie first and pushed later through an outbox. Timers are computed from stored event timestamps, never from in-memory counters.
- **Foreground alarm:** when an open task reaches its planned end, the app beeps and vibrates where supported. It rings once per task and is controlled from **Me → Task alarm** with a **Test alarm** button. It works only while the app is open; background push is out of scope.
- **Rule-based only:** no AI/ML, no computed nurse score, no ranking or leaderboard. Tier 1–2 tasks are never auto-deferred. The two lists are fixed demo content and need clinical review.
- **Evaluation:** SUS and raw NASA-TLX forms, plus CSV exports for analysis.

## Demo accounts

| Username | PIN | Role |
| --- | --- | --- |
| `amina` | `1111` | Nurse |
| `yara` | `2222` | Nurse |
| `omar` | `3333` | Nurse |
| `head` | `9999` | Head nurse |

The login screen has one-tap **Enter as Nurse** (Amina) and **Enter as Head nurse** (Layla) buttons for the discussion demo. Demo unit assignments: `amina` → Unit A, `yara` → Unit A and Unit B, `omar` → Unit B. The head-nurse demo account can create more units and change these assignments.

The shift-start screen has a demo option that backdates the shift by two hours, so overdue and tier-ordering states are visible immediately. Turn it off for a live practice shift. A nurse shift creates exactly the 12 agreed staff-nurse tasks. The head-nurse account can start a separate head-nurse shift from **My tasks**; that shift creates exactly the 14 agreed head-nurse tasks. No bed tasks are created.

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
npm run db:seed           # users, units, assignments, templates, config
npm run dev
```

Open `http://localhost:3000`.

Useful commands:

```bash
npm run typecheck         # tsc --noEmit
npm test                  # 33 domain tests
npm run lint              # product-rule guard (no AI, no IDs, pure domain)
npm run build             # web production build (webpack)
npm run build:mobile      # static export for the APK
npm run simulate:reset    # deterministic 14-shift demo dataset
npm run db:reset-shifts -- --yes  # delete non-simulated UI-test shifts
npm run test:api          # disposable Docker Postgres required
npm run test:e2e          # Playwright auth, fast login, role, privacy, unit, To Do/Time Log, handover and shift-limit checks
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

It creates a real shift, exercises the task queue, To Do/Time Log, handover and shift end, and writes screenshots under `/tmp/opencode/icu-capture`. (The script is updated with the shift-level flow; if it fails, treat the Playwright suite as the source of evidence.)

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

The workflow has produced debug artifacts before. Run `45423196910` built the older 16-hour shift-limit release from commit `bd9e814`; its ZIP was 4,882,751 bytes with digest `sha256:4fbcd2651fb63109a383492eaf778db36a2710a1d82d06aa8980a974390f50e4`. The current shift-task/alarm release has not yet produced a new APK in this workspace. Installation/opening on a physical Android device remains **NOT VERIFIED**.

Debug signing is automatic. The APK is for demonstration, not Play Store distribution. `NEXT_PUBLIC_API_URL` is compiled into the bundle, so rebuild after changing the deployment URL.

## Privacy and scope

- There are no patient identifiers and no bed-level task records. Task titles and notes are free text, so the UI warns against typing identifiers.
- No patient records, photos, EHR integration, biometric/OAuth login, push notifications, iOS build, Arabic/RTL, admin screens, template editor UI, weighted TLX, TAM or AI.
- Head-nurse ratings are five manual criteria. No composite score or leaderboard is calculated.
- Demo task content and intervals require ICU clinical review before any real use.
- The 14 head-nurse and 12 staff-nurse task templates are demo content from the agreed lists, not an official assignment policy.

See `ASSUMPTIONS.md`, `PROGRESS.md` and `EVALUATION.md` for decisions and evidence.
