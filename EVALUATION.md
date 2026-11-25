# Evaluation

This file separates **engineering evidence** (things that were run and observed) from the **planned nursing evaluation** (things that still need real participants and clinical review). No real nurse or patient data has been collected.

## 1. Product question

Can a rule-based, offline-first task planner make tier 1–2 ICU work visible, reduce the effort of restarting interrupted tasks, and produce a defensible handover/summary without turning care into a performance score?

The prototype deliberately excludes AI, automatic clinical decisions and nurse ranking. It records what happened and helps the nurse re-plan.

## 2. Planned study design (not yet run)

- **Participants:** 6–10 ICU nurses for formative usability, plus 1–2 head nurses for review/export feedback. Convenience sample; thesis demo.
- **Design:** within-subject, paper/shift-board baseline versus TaskLog, counterbalanced order if the sample allows.
- **Tasks:** start a shift with the 12-task staff-nurse list; identify the most critical open task; start and finish a task; edit an unfinished task and add a note; log an interruption; use the To Do / Time Log; finalize the shift-level handover; end the shift; read the summary. Head nurse: start the 14-task head-nurse list, find a nurse shift, inspect the timeline, edit an unfinished task or add a note, submit five manual ratings, export CSV.
- **Measures:**
  - SUS after the app session (paper version may be collected for comparison only if the protocol is approved).
  - Raw NASA-TLX after a simulated emergency/handover scenario.
  - Observed task time and errors for start/finish (target ≤2 taps), quick add (≤3 taps), emergency, handover and shift end.
  - Short semi-structured interview on trust, interruption recovery and identifier risk.
- **Inclusion/exclusion:** practising ICU nurses; exclude anyone unable to give consent. No patient data is collected. Scenarios use demo shift tasks and participant codes only.
- **Analysis:** descriptive SUS/TLX summaries and paired differences if the sample supports them; task-time medians; thematic analysis of interview notes. No inferential claim is planned from a convenience sample.
- **Ethics:** institutional approval and informed consent are required before recruiting. The app is labelled as a non-medical-device planning aid throughout.

## 3. Engineering evidence (observed)

Environment: Linux workspace, Node 22, Next.js 16.3.1, local Neon database, Chromium via Playwright, plus the production deployment at <https://icu-tasklog.vercel.app>.

| Check | Command | Observed result |
| --- | --- | --- |
| Domain tests | `./node_modules/.bin/vitest run` | **33 passed** |
| TypeScript | `./node_modules/.bin/tsc --noEmit` | clean |
| Product-rule lint | `npm run lint` | passed, 52 source files / 5 domain files |
| API integration | `npm run test:api` against Docker `postgres:16-alpine` | **56 checks passed** |
| Task edit + note | domain reducer and API tests | observed: both roles edit an unfinished task; `TASK_EDITED` is appended; done task returns 409; note survives pull; handover projection carries note |
| To Do + Time Log | domain reducer, API checks, Playwright | observed: future To Do creation; time-only past interval resolves on the shift date; time log marks done and records duration; second log rejected; missed/live-timer logs rejected; tick-only task can receive a later log |
| Shift tasks | domain reducer, API checks, Playwright | observed: nurse shift creates exactly 12 shift-level tasks; head shift creates exactly 14; no bed tasks or bed rows; handover uses the synthetic `shift` id; head-nurse shifts excluded from nurse analytics/export |
| Shift length limit | domain test, API checks, Playwright | observed: 16-hour cap; stale nurse shift auto-ends on app load and returns to `/shift-start`; stale head shift is capped before a new head shift starts; open tasks become missed |
| Earlier live browser checkup (bed release) | production Vercel deployment | historical: signup landed on `/shift-start`; all demo accounts signed in; the older nurse shift created 53 tasks (41 bed + 12 shift); head shift created 14 tasks and was excluded from nurse shifts. Superseded by the current 12/14 shift-only release. |
| Dynamic units | head `POST/PATCH/DELETE /api/units`, nurse assignment, `GET /api/units`, unit filters | observed: create 201, duplicate 409, nurse create 403, assignment 200, nurse sees assigned unit, shift carries `unitId` |
| Nurse self-registration | `POST /api/auth/register` | **201**; role forced to `nurse`, PIN hashed, duplicate username 409, client role injection 400 |
| Playwright auth/role/privacy/units/planning | `npm run test:e2e` | **13 passed** (1.9m): both fast logins, registration, role routing, privacy, unit flow, 12-task queue, To Do/Time Log, shift-level handover, 14-task head list, 16-hour auto-end |
| Web build | `npm run build` | success; all app routes + `ƒ /api/[[...route]]`, including `/plan` and `/head/tasks` |
| Mobile build | `npm run build:mobile` | success; **21 static pages**, no API route; `src/app/api` restored |
| Full nurse flow | Playwright `planning.spec.ts` | nurse starts the 12-task shift, starts/finishes a task, plans a future task, logs a past interval, finalizes the shift-level handover and ends the shift; the optional screenshot script is not used as pass/fail evidence |
| Demo data | `npm run simulate:reset` | 14 finished shifts across 2 units, 604 events, 14 shift handovers, 11 reviews, 9 surveys; 26 templates (12 nurse, 14 head), 0 beds |
| Head analytics | `GET /api/analytics/unit?days=30` | 14 shifts, completion 81.0%, tier 1–2 on-time 56.3%, direct care 97.6 min, indirect 79.6 min, interruptions 54.4 min, emergency 9.0 min |
| Unit analytics | `GET /api/analytics/unit?days=30&unitId=unit-a` | **200**; 7 shifts filtered to Unit A, completion 85.7% |
| Unit shift filter | `GET /api/shifts?unitId=unit-a` | **200**; only Unit A shifts, each with `unitId`/`unitName` |
| Live health | `GET https://icu-tasklog.vercel.app/api/health` | **200**; `{"ok":true,"database":true}` |
| Live login | `POST /api/auth/login` on Vercel | **200** for `amina/1111` and `head/9999`; role returned in `user.role` |
| Live nurse registration | `POST /api/auth/register` on Vercel | **201**; nurse role, unique `N-...` code, login **200**; duplicate username **409**; role injection **400** |
| Live head analytics | `GET /api/analytics/unit` on Vercel | **200**; 14 shifts |
| Live units | `GET /api/units` with head token on Vercel | **200**; Unit A and Unit B |
| Live unit shift filter | `GET /api/shifts?unitId=unit-a` on Vercel | **200**; 7 shifts, all `unitId=unit-a`, each with `unitName=Unit A` |
| Live unit analytics | `GET /api/analytics/unit?days=30&unitId=unit-a` on Vercel | **200**; 7 shifts, completion 81.0% |
| Live planned windows | `GET /api/shifts/sim-20261120-u-nurse-2` on Vercel | **200**; 36 `TASK_CREATED` events carry `plannedFrom`/`plannedTo`; no `dueAt` |
| Live head task list after null-ID fix | head shift detail for `sim-20261120-u-nurse-2` on Vercel | **rendered 36 tasks** (previously 0); finished-task lock shown; no `ZodError` |
| Live task-edit route deployed | `PATCH /api/shifts/does-not-exist/tasks/does-not-exist` on Vercel with head token | **404**; `{"error":"Shift not found"}` — the new route is present, not a generic 404 |
| Live frozen-task guard | `PATCH /api/shifts/sim-20261120-u-nurse-2/tasks/...` on Vercel with head token | **409**; `{"error":"Completed or missed tasks cannot be altered"}` |
| Live unauth task edit | `PATCH /api/shifts/.../tasks/...` on Vercel without token | **401**; `{"error":"Missing bearer token"}` |
| Live CORS preflight | `OPTIONS /api/auth/login`, `Origin: https://localhost` | **204**; `access-control-allow-origin: https://localhost` |
| Live CORS unit update | `OPTIONS /api/units/unit-a`, requested `PATCH` | **204**; `access-control-allow-methods` includes `PATCH`, `DELETE` |
| Live To Do/Time Log + head tasks | live API against Vercel after `2582d47` deploy | `/plan` and `/head/tasks` **200**; head start **200** with 15 events/14 tasks/0 null IDs; To Do **200**; time log **200**; end summary 15 total, 1 done, 14 missed; analytics unchanged 14→14; nurse list and CSV exclude head shift; sync pull 39 templates (14 head, 26 shift) |
| Live browser smoke | Playwright against Vercel | nurse login reached `/shift-start`; head login reached `/head`; no page errors |
| Earlier local task edit (bed release) | production web build + disposable Docker Postgres | historical: nurse started a bed shift and added a note; head nurse saw the bed tasks and edited the note; timeline showed two `TASK_EDITED` events. Superseded by the shift-only release. |
| Current local browser suite | production web build + Playwright | 13/13 passed after the shift-only change; nurse sees 12 tasks, head sees 14, handover is shift-level, and a >16-hour shift auto-ends. No page errors. |
| Android CI build | GitHub Actions run `45423196910` | **success** for `bd9e814`; `icu-tasklog-debug-apk` artifact ZIP 4,882,751 bytes, digest `sha256:4fbcd2651fb63109a383492eaf778db36a2710a1d82d06aa8980a974390f50e4`; APK not downloaded/inspected here |

### Production deployment

- Web/API: <https://icu-tasklog.vercel.app> — one Vercel Next.js project; `/api/*` is served by the mounted Hono app.
- Task-edit deployment `e7cec95` succeeded on Vercel. Live checks after deploy: health 200, head login 200, unauthenticated task-edit `PATCH` 401, unknown shift 404 `Shift not found`, and a frozen production task 409 `Completed or missed tasks cannot be altered`. The successful edit/note path was verified against disposable Postgres, not written into the production demo dataset.
- Null-ID fix deployment `501b9af` succeeded on Vercel. The live head shift detail now renders 36 tasks (previously 0) and shows the finished-task lock, so the `ZodError` path is gone.
- To Do/Time Log deployment `2582d47` succeeded on Vercel. Live checks: `/plan` and `/head/tasks` 200; head-nurse start 200 with 15 events and 14 shift tasks; time log 200; To Do creation 200; end summary 15 tasks (1 done, 14 missed); analytics 14→14; nurse shift list/CSV exclude the head shift; sync pull has 39 templates.
- Observed checks after the unit deployment: health 200, head login 200, units 200 (Unit A/Unit B), unit-filtered shifts 200 (7 Unit A shifts), unit analytics 200 (7 shifts, 81.0% completion), CORS `PATCH` preflight 204.
- Nurse self-registration: live `POST /api/auth/register` returned 201, created a nurse account, and that account signed in successfully. Duplicate username returned 409 and a client-supplied `head_nurse` role returned 400. The verification accounts were removed after the checks.
- Playwright smoke test: nurse login reached `/shift-start`, head login reached `/head`, no page errors. The unit page was also opened live to capture `17-head-units.png`.
- Android artifact: GitHub Actions run `45423196910` succeeded for `bd9e814`. The `icu-tasklog-debug-apk` artifact exists (ZIP 4,882,751 bytes, digest `sha256:4fbcd2651fb63109a383492eaf778db36a2710a1d82d06aa8980a974390f50e4`). The APK inside was not downloaded or inspected in this workspace. The earlier inspected artifact was run `45031515210` for `501b9af` (`app-debug.apk`, 5,622,705 bytes, SHA-256 `a5ff98ce34d3335ea706bd0e27ac7326d1128ed254ebeeded3a1c643687524a1`).
- **NOT VERIFIED:** installing and opening the APK on a physical Android device. No device or local Android SDK was available in this workspace.

The simulation is deterministic and uses only shift-level task data and participant codes. It is demonstration data, not a study result.

### What the Playwright suite proved

- Both one-tap demo logins work: Nurse → Amina, Head nurse → Layla.
- A nurse signs in, chooses an assigned unit and starts the 12-task shift.
- Starting and finishing a task updates the task state and active timer.
- A future task can be planned in To Do; a past interval can be logged in Time Log.
- The shift-level handover can be finalized and becomes immutable.
- A head nurse starts a separate 14-task shift; it is excluded from nurse analytics and export.
- A shift older than 16 hours auto-ends and returns to `/shift-start`.
- The unit flow still supports assignment, unit creation and removal.
- No page errors were observed in the 13-test run.

### Screenshots

Final captures are in `evaluation/screenshots/`:

| File | Screen |
| --- | --- |
| `01-login.png` | Login and disclaimer |
| `02-shift-start.png` | Shift start with backdated demo option |
| `03-beds.png` | Historical bed board (screen removed) |
| `04-tasks.png` | Tier-sorted task queue |
| `05-active-timer.png` | Sticky active timer |
| `06-quick-add.png` | Quick-add sheet |
| `07-emergency.png` | Emergency mode with tier 1–2 protection |
| `08-reschedule.png` | Deferred task reschedule review |
| `09-handover.png` | Finalized handover |
| `10-summary.png` | Timestamp-based shift summary from demo data |
| `11-head-dashboard.png` | Head-nurse unit dashboard |
| `12-head-shifts.png` | Shift list with review status |
| `13-head-shift-detail.png` | Shift detail and event timeline |
| `14-head-review.png` | Five manual ratings |
| `15-head-export.png` | CSV export |
| `16-surveys.png` | SUS/raw TLX forms |
| `17-head-units.png` | Dynamic unit editor and nurse assignment |

`02-shift-start.png`, `11-head-dashboard.png` and `17-head-units.png` were recaptured after the dynamic-unit changes. The remaining screenshots show the same flows and timestamp rules from the pre-unit capture pass.

## 4. Usability targets to check with participants

| Target | How it is supported | Evidence status |
| --- | --- | --- |
| Start/finish a task in ≤2 taps | Start on card; finish on sticky bar or card | Implemented; novice timing **NOT MEASURED** |
| Quick-add in ≤3 taps | Header plus → preset | Implemented; novice timing **NOT MEASURED** |
| 48 px targets | `min-h-touch`, 44–48 px controls | Visual check only |
| Not colour-only | Tier icons + text, status text, shapes | Visual check only |
| Emergency confirmation | Confirm dialog before start/end | Implemented and flow-checked |
| Handover/shift-end confirmation | Confirm dialogs | Implemented and flow-checked |
| Persistent disclaimer | Login, app shell footer/sidebar, handover | Implemented and visually checked |
| No identifiers | No patient fields in schema; warnings; product lint | Schema/lint checked; human free-text risk remains |

## 5. Limitations and threats to validity

- **No participants yet.** SUS/TLX values must come from the approved study, not the simulated dataset.
- **Clinical content is illustrative.** Task tiers, intervals and expected durations need ICU expert review.
- **Free-text task titles and notes can contain a name.** There are no patient fields or bed records, but the UI warns and limits length; rule-based detection is not reliable. This is an ethical/usability risk to test.
- **Nurse self-registration is open.** Anyone who can reach the deployment can create a nurse account; head-nurse accounts remain controlled. There is no email verification, rate limit or PIN recovery. Account creation requires connectivity, and this is acceptable only for the thesis demo.
- **Small single-centre sample.** Results will not generalise.
- **Neon/network variability.** Transient DNS/timeouts were observed locally; nurse actions remain in Dexie, but login and head screens need connectivity.
- **On-device APK behaviour is not measured.** The Vercel deployment and the GitHub Actions APK build were observed, but the APK was not installed or opened on a physical Android device in this workspace. The new APK from run `45423196910` was not downloaded/inspected here, so To Do/Time Log and the 16-hour shift limit on Android are **NOT VERIFIED**.
- **Demo backdating** makes overdue states visible immediately; it is not a real shift timestamp and is labelled in the UI.
- **Head-nurse task list is online-only.** The 14 head-nurse tasks and To Do/Time Log actions need the API; the nurse offline Dexie/outbox flow is unchanged.

## 6. Reproduction commands

```bash
npm run typecheck
npm test
npm run lint
npm run build
npm run build:mobile
npm run simulate:reset

# API tests (local disposable database)
docker run -d --rm --name icu-api-test-db \
  -e POSTGRES_PASSWORD=test -e POSTGRES_DB=icu_test \
  -p 55432:5432 postgres:16-alpine
DATABASE_URL=postgres://postgres:test@localhost:55432/icu_test \
JWT_SECRET=api-test-secret npm run test:api
docker stop icu-api-test-db

# UI
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/path/to/chrome E2E_NO_SERVER=1 npm run test:e2e
# Optional screenshot walkthrough; not a pass/fail test
node scripts/flow-check.mjs
```
