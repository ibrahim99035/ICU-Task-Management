# Progress

## P1 — Domain core (done)
- Pure TypeScript domain in `src/domain`: Zod event schema, reducer/state machine, emergency planning, rescheduling, timestamp durations, missed rule, recurring tasks, handover, shift summary, SUS/raw TLX.
- `22` Vitest tests passing.
- TypeScript clean.

## P2 — Offline nurse flow (done)
- Dexie schema, Zustand app store, outbox sync, projection, actions.
- Login, self-registration for nurse accounts, shift start (backdated demo option), bed board, task queue, task detail/correction, active timer bar, interruptions, quick add.
- Emergency start/end with tier 1–2 protection, tier 3–4 deferral, reschedule review, deferred queue filter.
- Handover snapshot/finalize/copy/share/print, shift summary with SVG/CSS charts, manual review display, SUS/raw TLX forms, privacy screen.

## P3 — API and head nurse (done)
- Hono at `src/app/api/[[...route]]/route.ts`, JWT auth, role guards, CORS/trailing-slash handling.
- Nurse self-registration: `POST /api/auth/register`, nurse role enforced server-side, bcrypt PIN, unique username/participant code, duplicate handling.
- Sync push/pull, server summary recomputation, shifts, reviews, analytics, surveys, CSV export.
- Head dashboard, shift list, shift detail, review form, export page.
- Neon schema applied and seeded: `amina/1111`, `yara/2222`, `omar/3333`, `head/9999`.

## P4 — Evaluation data and automation (done)
- `scripts/simulate.ts` creates 14 deterministic finished shifts, 1,369 events, 28 handovers, 11 reviews and 9 surveys using bed labels and participant codes only.
- `scripts/api-test.ts`: 26 checks against disposable Docker Postgres, including self-registration, PIN hashing, duplicate username and role injection.
- Playwright auth/role/privacy suite: `5` passing, including account creation.
- `scripts/flow-check.mjs`: emergency → reschedule → timer → quick add → handover → shift end verified end to end.
- Product-rule lint (`npm run lint`), typecheck, web build and mobile static export all pass.
- Final web build: all app routes plus the API route. Mobile export: 17 static pages, no API route.

## P5 — Deployment and APK packaging (done)
- Live deployment: <https://icu-tasklog.vercel.app> — one Next.js project with the Hono API at `/api`.
- Production checks observed: health `200`, nurse and head login `200`, head analytics `200`, CORS preflight `204`; Playwright logins reached `/shift-start` and `/head` with no page errors.
- Live self-registration observed: `201` for a nurse account, login `200`, duplicate `409`, client role injection `400`; the check account was removed.
- Capacitor 8.6 config, icon/splash resources, GitHub Actions workflow.
- `npm run build:mobile` verified locally: static export succeeds and `src/app/api` is restored.
- GitHub Actions run `43312717097` succeeded: `app-debug.apk`, 5,600,362 bytes, SHA-256 `ce21231cbe455d7ca498b0185c2eacc1f236acb11795fa1ac38f84e526a3f7fe`.
- **NOT VERIFIED:** installation and opening of the APK on a physical Android device. No device or local Android SDK was available in this workspace.

## NOT VERIFIED
- APK installation/opening on a physical device.
- Real ICU nurse usability sessions, SUS/TLX results and clinical review of demo task tiers.
- Neon transient DNS failures observed locally are environmental; production reliability is not measured.

## Evidence
- `EVALUATION.md` records commands, observed outputs and screenshot paths.
- `evaluation/screenshots/` contains the final UI captures.
