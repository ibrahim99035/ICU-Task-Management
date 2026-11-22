# Progress

## P1 — Domain core (done)
- Pure TypeScript domain in `src/domain`: Zod event schema, reducer/state machine, emergency planning, rescheduling, timestamp durations, missed rule, recurring tasks, handover, shift summary, SUS/raw TLX.
- `28` Vitest tests passing, including unit propagation, legacy no-unit events and audited task edits.
- TypeScript clean.

## P2 — Offline nurse flow (done)
- Dexie schema, Zustand app store, outbox sync, projection, actions.
- Login, self-registration for nurse accounts, shift start (backdated demo option), bed board, task queue, task detail/correction, edit/note on unfinished tasks, active timer bar, interruptions, quick add.
- Emergency start/end with tier 1–2 protection, tier 3–4 deferral, reschedule review, deferred queue filter.
- Handover snapshot/finalize/copy/share/print, shift summary with SVG/CSS charts, manual review display, SUS/raw TLX forms, privacy screen.

## P3 — API and head nurse (done)
- Hono at `src/app/api/[[...route]]/route.ts`, JWT auth, role guards, CORS/trailing-slash handling.
- Nurse self-registration: `POST /api/auth/register`, nurse role enforced server-side, bcrypt PIN, unique username/participant code, duplicate handling.
- Dynamic units: `units` and `unit_nurses` tables, shift `unit_id`, head-nurse CRUD/assignment routes, nurse-assigned-unit pull, unit filters on shifts/analytics/export.
- Sync push/pull, server summary recomputation, shifts, reviews, analytics, surveys, CSV export.
- Head dashboard, unit management, shift list, shift detail with task edit/note, review form, export page.
- Audited task alteration: `TASK_EDITED` domain event, nurse local edit path, `PATCH /api/shifts/:shiftId/tasks/:taskId` for both roles with per-shift ownership checks, note surfaced on task cards, task detail, handover and head timeline.
- Nurse shift start requires an assigned active unit; tasks inherit the unit; legacy shifts remain under “Unassigned”.
- Neon schema applied and seeded: `amina/1111`, `yara/2222`, `omar/3333`, `head/9999`.

## P4 — Evaluation data and automation (done)
- `scripts/simulate.ts` creates 14 deterministic finished shifts, 1,369 events, 28 handovers, 11 reviews and 9 surveys using bed labels and participant codes only.
- `scripts/api-test.ts`: 42 checks against disposable Docker Postgres, including self-registration, PIN hashing, duplicate username, role injection, unit CRUD, assignment, unit filters, CSV unit columns, nurse/head task edits, frozen finished tasks and nullable event-id normalization on shift detail.
- Playwright auth/role/privacy/unit suite: `7` passing, including account creation, assigned-unit selection and head-nurse unit management.
- Local browser task-edit check against the production web build and disposable Postgres: nurse started a shift and added a note; the note badge and task detail updated. Head nurse opened the same shift, saw all 41 tasks, the nurse note, and edited the note. The timeline then showed two `TASK_EDITED` events. No page errors.
- `scripts/flow-check.mjs`: emergency → reschedule → timer → quick add → handover → shift end verified end to end.
- Product-rule lint (`npm run lint`), typecheck, web build and mobile static export all pass.
- Final web build: all app routes plus the API route. Mobile export: 19 static pages, no API route.

## P5 — Deployment and APK packaging (done)
- Live deployment: <https://icu-tasklog.vercel.app> — one Next.js project with the Hono API at `/api`.
- Task-edit deploy `e7cec95` succeeded on Vercel. Live checks after deploy: health `200`, head login `200`, unauthenticated `PATCH` `401`, unknown shift `404` with `{"error":"Shift not found"}`, and a frozen production task `409` with `{"error":"Completed or missed tasks cannot be altered"}`. Successful edit/note persistence was verified against the disposable Postgres suite (42 checks), not written into the production demo dataset.
- Null-ID fix deploy `501b9af` succeeded on Vercel. The live head shift detail now renders 36 tasks instead of 0, and the page shows the finished-task lock instead of a `ZodError`.
- Production checks observed after unit deployment: health `200`, head login `200`, units `200` (Unit A/Unit B), `GET /api/shifts?unitId=unit-a` `200` with 7 Unit A shifts, unit analytics `200` with 7 shifts, CORS `PATCH` preflight `204`.
- Live self-registration observed earlier: `201` for a nurse account, login `200`, duplicate `409`, client role injection `400`; test accounts were removed.
- Capacitor 8.6 config, icon/splash resources, GitHub Actions workflow.
- `npm run build:mobile` verified locally: static export succeeds and `src/app/api` is restored.
- GitHub Actions run `45031515210` succeeded for the null-ID fix commit `501b9af`: `app-debug.apk`, 5,622,705 bytes, SHA-256 `a5ff98ce34d3335ea706bd0e27ac7326d1128ed254ebeeded3a1c643687524a1`. The artifact was downloaded and unpacked; the bundled JavaScript contains the task-edit UI strings and `https://icu-tasklog.vercel.app`.
- Screenshots `02-shift-start.png`, `11-head-dashboard.png` and `17-head-units.png` were refreshed from the live deployment.
- **NOT VERIFIED:** installation and opening of the APK on a physical Android device. No device or local Android SDK was available in this workspace.

## NOT VERIFIED
- APK installation/opening on a physical device.
- Real ICU nurse usability sessions, SUS/TLX results and clinical review of demo task tiers.
- Neon transient DNS failures observed locally are environmental; production reliability is not measured.

## Evidence
- `EVALUATION.md` records commands, observed outputs and screenshot paths.
- `evaluation/screenshots/` contains the final UI captures.
