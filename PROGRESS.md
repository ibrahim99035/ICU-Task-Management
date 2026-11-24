# Progress

## P1 — Domain core (done)
- Pure TypeScript domain in `src/domain`: Zod event schema, reducer/state machine, emergency planning, rescheduling, timestamp durations, missed rule, recurring tasks, handover, shift summary, SUS/raw TLX.
- `33` Vitest tests passing, including unit propagation, legacy no-unit events, audited task edits, time logs, shift-scoped tasks and the 16-hour shift limit.
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
- `scripts/api-test.ts`: 56 checks against disposable Docker Postgres, including self-registration, PIN hashing, duplicate username, role injection, unit CRUD, assignment, unit filters, CSV unit columns, nurse/head task edits, frozen finished tasks, nullable event-id normalization, head-nurse shift start/end, 14 head tasks, To Do creation, time logging, completion, analytics/export exclusion.
- Playwright auth/role/privacy/unit/planning suite: `10` passing, including account creation, assigned-unit selection, head-nurse unit management, nurse To Do/Time Log, head-nurse My tasks and stale-shift auto-end.
- Local browser task-edit check against the production web build and disposable Postgres: nurse started a shift and added a note; the note badge and task detail updated. Head nurse opened the same shift, saw all 41 tasks, the nurse note, and edited the note. The timeline then showed two `TASK_EDITED` events. No page errors.
- `scripts/flow-check.mjs`: emergency → reschedule → timer → quick add → handover → shift end verified end to end.
- Product-rule lint (`npm run lint`), typecheck, web build and mobile static export all pass.
- Final web build: all app routes plus the API route. Mobile export: 19 static pages, no API route.

## P6 — To Do, Time Log and head-nurse own shift (done)
- Added task `scope` (`bed` or `shift`), optional `bedId`, `TASK_TIME_LOGGED` event, task `timeLogs`, and shift `kind` (`nurse` or `head_nurse`).
- Added 12 staff-nurse shift tasks alongside the existing 41 bed tasks; a nurse shift now creates 53 tasks. Shift tasks have no bed and appear in the queue, plan board and handover data.
- Added a nurse **Plan** page with To do and Time log tabs, future-only manual planning, time-only past intervals resolved on the shift date, overnight support, tick-only completion and audited edit/note reuse.
- Added a separate head-nurse shift and `/head/tasks` **My tasks** page with 14 head-nurse tasks, start/end, To Do, Time Log, complete and edit/note. Head-nurse task management is online-only.
- Head-nurse shifts are excluded from nurse analytics, reviews and CSV export. Head nurses still cannot execute nurse tasks.
- Added `role`/`scope` to task templates, `kind` to shifts, schema SQL migration, seed updates and a local template version so Dexie refreshes templates without deleting task data.
- Added a 16-hour shift limit (two normal 8-hour shifts). A stale nurse shift auto-ends on app load; a stale head-nurse shift auto-ends before listing or starting a head shift. Open tasks are missed at the cap.
- Evidence: TypeScript clean; product-rule lint passed 50 source files / 5 domain files; 33 domain tests; 56 API checks; 10 Playwright tests; web build; mobile static export (21 pages).
- Vercel deploy of `2582d47`: `/plan` and `/head/tasks` returned `200`. Live head-nurse start returned `200`, 15 events and 14 shift tasks with 0 null IDs; live To Do creation and time log returned `200`; end returned a 15-task summary (1 done, 14 missed). Analytics stayed at 14 shifts before/after; nurse shift list and CSV excluded the head shift; sync pull returned 39 templates (14 head-nurse, 26 shift-scoped).
- Android CI run `45412634264` succeeded for `5a55c86`; the `icu-tasklog-debug-apk` artifact exists (ZIP 4,882,454 bytes, digest `sha256:055fb6c6560f52cbd618b5f87b75ff79647e82c2bcf6830c3ec27c7ad2c5b8d1`).
- **NOT VERIFIED:** the APK file was not downloaded/inspected here, and on-device To Do/Time Log behaviour has not been tested.
- **Live browser checkup (2026-11-24):** signed up `checknurse24`, signed in with `amina`, `yara`, `omar` and `head`, assigned the new nurse to Unit A, started a fresh 53-task nurse shift, added a To Do item, logged a past interval, and ended the shift. Observed 54 total tasks, 1 done and 53 missed. Started a 14-task head-nurse shift, added a To Do item, logged a past interval, and ended it; the API summary showed 15 total, 1 done and 14 missed. The head-nurse shift did not appear on the nurse-shifts page. Amina's stale 49-hour shift auto-ended at exactly 16 hours with 41 tasks missed and 960 total minutes.

## P5 — Deployment and APK packaging (done)
- Live deployment: <https://icu-tasklog.vercel.app> — one Next.js project with the Hono API at `/api`.
- Task-edit deploy `e7cec95` succeeded on Vercel. Live checks after deploy: health `200`, head login `200`, unauthenticated `PATCH` `401`, unknown shift `404` with `{"error":"Shift not found"}`, and a frozen production task `409` with `{"error":"Completed or missed tasks cannot be altered"}`. Successful edit/note persistence was verified against the disposable Postgres suite (42 checks), not written into the production demo dataset.
- Null-ID fix deploy `501b9af` succeeded on Vercel. The live head shift detail now renders 36 tasks instead of 0, and the page shows the finished-task lock instead of a `ZodError`.
- Production checks observed after unit deployment: health `200`, head login `200`, units `200` (Unit A/Unit B), `GET /api/shifts?unitId=unit-a` `200` with 7 Unit A shifts, unit analytics `200` with 7 shifts, CORS `PATCH` preflight `204`.
- Live self-registration observed earlier: `201` for a nurse account, login `200`, duplicate `409`, client role injection `400`; test accounts were removed.
- Capacitor 8.6 config, icon/splash resources, GitHub Actions workflow.
- `npm run build:mobile` verified locally: static export succeeds and `src/app/api` is restored.
- GitHub Actions run `45031515210` succeeded for the null-ID fix commit `501b9af`: `app-debug.apk`, 5,622,705 bytes, SHA-256 `a5ff98ce34d3335ea706bd0e27ac7326d1128ed254ebeeded3a1c643687524a1`. That older artifact was downloaded and unpacked; its bundled JavaScript contains the task-edit UI strings and `https://icu-tasklog.vercel.app`.
- GitHub Actions run `45412634264` succeeded for the shift-limit commit `5a55c86`. The new artifact ZIP is 4,882,454 bytes with digest `sha256:055fb6c6560f52cbd618b5f87b75ff79647e82c2bcf6830c3ec27c7ad2c5b8d1`.
- Screenshots `02-shift-start.png`, `11-head-dashboard.png` and `17-head-units.png` were refreshed from the live deployment.
- **NOT VERIFIED:** installation and opening of the APK on a physical Android device. No device or local Android SDK was available in this workspace.

## NOT VERIFIED
- APK installation/opening on a physical device.
- Real ICU nurse usability sessions, SUS/TLX results and clinical review of demo task tiers.
- Neon transient DNS failures observed locally are environmental; production reliability is not measured.

## Evidence
- `EVALUATION.md` records commands, observed outputs and screenshot paths.
- `evaluation/screenshots/` contains the final UI captures.
