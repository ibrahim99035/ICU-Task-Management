# Evaluation

This file separates **engineering evidence** (things that were run and observed) from the **planned nursing evaluation** (things that still need real participants and clinical review). No real nurse or patient data has been collected.

## 1. Product question

Can a rule-based, offline-first task planner make tier 1–2 ICU work visible, reduce the effort of restarting interrupted tasks, and produce a defensible handover/summary without turning care into a performance score?

The prototype deliberately excludes AI, automatic clinical decisions and nurse ranking. It records what happened and helps the nurse re-plan.

## 2. Planned study design (not yet run)

- **Participants:** 6–10 ICU nurses for formative usability, plus 1–2 head nurses for review/export feedback. Convenience sample; thesis demo.
- **Design:** within-subject, paper/shift-board baseline versus TaskLog, counterbalanced order if the sample allows.
- **Tasks:** start a shift for six beds; identify the most critical open task; start and finish a task; edit an unfinished task and add a note; log an interruption; handle an emergency on one bed; confirm deferred-task times; finalize a handover; end the shift; read the summary. Head nurse: find a shift, inspect the timeline, edit an unfinished task or add a note, submit five manual ratings, export CSV.
- **Measures:**
  - SUS after the app session (paper version may be collected for comparison only if the protocol is approved).
  - Raw NASA-TLX after a simulated emergency/handover scenario.
  - Observed task time and errors for start/finish (target ≤2 taps), quick add (≤3 taps), emergency, handover and shift end.
  - Short semi-structured interview on trust, interruption recovery and identifier risk.
- **Inclusion/exclusion:** practising ICU nurses; exclude anyone unable to give consent. No patient data is collected. Scenarios use demo beds and practice tasks.
- **Analysis:** descriptive SUS/TLX summaries and paired differences if the sample supports them; task-time medians; thematic analysis of interview notes. No inferential claim is planned from a convenience sample.
- **Ethics:** institutional approval and informed consent are required before recruiting. The app is labelled as a non-medical-device planning aid throughout.

## 3. Engineering evidence (observed)

Environment: Linux workspace, Node 22, Next.js 16.3.1, local Neon database, Chromium via Playwright, plus the production deployment at <https://icu-tasklog.vercel.app>.

| Check | Command | Observed result |
| --- | --- | --- |
| Domain tests | `./node_modules/.bin/vitest run` | **32 passed** |
| TypeScript | `./node_modules/.bin/tsc --noEmit` | clean |
| Product-rule lint | `npm run lint` | passed, 50 source files / 5 domain files |
| API integration | `npm run test:api` against Docker `postgres:16-alpine` | **52 checks passed** |
| Task edit + note | domain reducer and API tests | observed: both roles edit an unfinished task; `TASK_EDITED` is appended; done task returns 409; note survives pull; handover projection carries note |
| To Do + Time Log | domain reducer, API checks, Playwright | observed: future To Do creation; time-only past interval resolves on the shift date; time log marks done and records duration; second log rejected; missed/live-timer logs rejected; tick-only task can receive a later log |
| Shift tasks | domain reducer, API checks, Playwright | observed: nurse shift creates 12 shift-level tasks plus 41 bed tasks; head shift creates 14 tasks; shift tasks have no bed; head-nurse shifts excluded from nurse analytics/export |
| Dynamic units | head `POST/PATCH/DELETE /api/units`, nurse assignment, `GET /api/units`, unit filters | observed: create 201, duplicate 409, nurse create 403, assignment 200, nurse sees assigned unit, shift carries `unitId` |
| Nurse self-registration | `POST /api/auth/register` | **201**; role forced to `nurse`, PIN hashed, duplicate username 409, client role injection 400 |
| Playwright auth/role/privacy/units/planning | `npm run test:e2e` | **9 passed** |
| Web build | `npm run build` | success; all app routes + `ƒ /api/[[...route]]`, including `/plan` and `/head/tasks` |
| Mobile build | `npm run build:mobile` | success; **21 static pages**, no API route; `src/app/api` restored |
| Full nurse flow | `node scripts/flow-check.mjs` | emergency banner, 4 reschedule proposals confirmed, task timer/finish, quick add, handover finalized, shift ended, no active shift |
| Demo data | `npm run simulate:reset` | 14 finished shifts across 2 units, 1,369 events, 28 handovers, 11 reviews, 9 surveys |
| Head analytics | `GET /api/analytics/unit?days=30` | 14 shifts, completion 79.4%, tier 1–2 on-time 59.1%, direct care 4h 18m, indirect 1h 6m, interruptions 44m, emergency 8m |
| Unit analytics | `GET /api/analytics/unit?days=30&unitId=unit-a` | **200**; 7 shifts filtered to Unit A |
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
| Local browser task edit (both roles) | production web build + disposable Docker Postgres | nurse started a shift, added a note; note badge and task detail updated. Head nurse saw all 41 bed tasks and the note, edited the note; timeline showed two `TASK_EDITED` events. No page errors |
| Local browser To Do/Time Log | production web build + disposable Docker Postgres + Playwright | nurse `yara` saw the 12 shift tasks, planned a future task, logged a past interval and ended the shift; head nurse started a head-nurse shift, saw the 14 tasks, planned a task and ended the shift. No page errors |
| Android CI build | GitHub Actions run `45316708579` | **success** for `2582d47`; `icu-tasklog-debug-apk` artifact ZIP 4,882,615 bytes, digest `sha256:940ba9b30cee1cf17b782823a6a5e268ce2cfcdaa6b2ca3b4e0474b9d3757a5b`; APK not downloaded/inspected here |

### Production deployment

- Web/API: <https://icu-tasklog.vercel.app> — one Vercel Next.js project; `/api/*` is served by the mounted Hono app.
- Task-edit deployment `e7cec95` succeeded on Vercel. Live checks after deploy: health 200, head login 200, unauthenticated task-edit `PATCH` 401, unknown shift 404 `Shift not found`, and a frozen production task 409 `Completed or missed tasks cannot be altered`. The successful edit/note path was verified against disposable Postgres, not written into the production demo dataset.
- Null-ID fix deployment `501b9af` succeeded on Vercel. The live head shift detail now renders 36 tasks (previously 0) and shows the finished-task lock, so the `ZodError` path is gone.
- To Do/Time Log deployment `2582d47` succeeded on Vercel. Live checks: `/plan` and `/head/tasks` 200; head-nurse start 200 with 15 events and 14 shift tasks; time log 200; To Do creation 200; end summary 15 tasks (1 done, 14 missed); analytics 14→14; nurse shift list/CSV exclude the head shift; sync pull has 39 templates.
- Observed checks after the unit deployment: health 200, head login 200, units 200 (Unit A/Unit B), unit-filtered shifts 200 (7 Unit A shifts), unit analytics 200 (7 shifts, 81.0% completion), CORS `PATCH` preflight 204.
- Nurse self-registration: live `POST /api/auth/register` returned 201, created a nurse account, and that account signed in successfully. Duplicate username returned 409 and a client-supplied `head_nurse` role returned 400. The verification accounts were removed after the checks.
- Playwright smoke test: nurse login reached `/shift-start`, head login reached `/head`, no page errors. The unit page was also opened live to capture `17-head-units.png`.
- Android artifact: GitHub Actions run `45316708579` succeeded for `2582d47`. The `icu-tasklog-debug-apk` artifact exists (ZIP 4,882,615 bytes, digest `sha256:940ba9b30cee1cf17b782823a6a5e268ce2cfcdaa6b2ca3b4e0474b9d3757a5b`). The APK inside was not downloaded or inspected in this workspace. The earlier inspected artifact was run `45031515210` for `501b9af` (`app-debug.apk`, 5,622,705 bytes, SHA-256 `a5ff98ce34d3335ea706bd0e27ac7326d1128ed254ebeeded3a1c643687524a1`).
- **NOT VERIFIED:** installing and opening the APK on a physical Android device. No device or local Android SDK was available in this workspace.

The simulation is deterministic and uses only bed labels and participant codes. It is demonstration data, not a study result.

### What the flow check proved

- Emergency start created an active emergency and flagged tier 1–2 tasks; the warning banner appeared.
- Emergency end produced four tier 3–4 reschedule proposals. No tier 1–2 task appeared in the proposal list.
- “Confirm all” wrote the new times and left the old times in the event log.
- Starting and finishing a task updated the task state and active bar.
- Quick add placed a preset task in the queue.
- Finalizing a handover created an immutable snapshot from the event log.
- Ending the shift marked open work missed and froze the summary; returning to `/shift-start` showed no active-shift banner.
- The same flow started from **Unit A**, and the resulting shift/summary carried `unitId=unit-a` and `unitName=Unit A`.
- Playwright unit checks verified that an assigned nurse can choose Unit A at shift start and that the head nurse can create and delete an unused unit.

### Screenshots

Final captures are in `evaluation/screenshots/`:

| File | Screen |
| --- | --- |
| `01-login.png` | Login and disclaimer |
| `02-shift-start.png` | Shift start with backdated demo option |
| `03-beds.png` | Bed board |
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
- **Free-text bed nicknames can contain a name.** The UI warns and limits length, but rule-based detection is not reliable. This is an ethical/usability risk to test.
- **Nurse self-registration is open.** Anyone who can reach the deployment can create a nurse account; head-nurse accounts remain controlled. There is no email verification, rate limit or PIN recovery. Account creation requires connectivity, and this is acceptable only for the thesis demo.
- **Small single-centre sample.** Results will not generalise.
- **Neon/network variability.** Transient DNS/timeouts were observed locally; nurse actions remain in Dexie, but login and head screens need connectivity.
- **On-device APK behaviour is not measured.** The Vercel deployment and the GitHub Actions APK build were observed, but the APK was not installed or opened on a physical Android device in this workspace. The new APK from run `45316708579` was not downloaded/inspected here, so To Do/Time Log on Android is **NOT VERIFIED**.
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
node scripts/flow-check.mjs
```
