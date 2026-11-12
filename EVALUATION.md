# Evaluation

This file separates **engineering evidence** (things that were run and observed) from the **planned nursing evaluation** (things that still need real participants and clinical review). No real nurse or patient data has been collected.

## 1. Product question

Can a rule-based, offline-first task planner make tier 1–2 ICU work visible, reduce the effort of restarting interrupted tasks, and produce a defensible handover/summary without turning care into a performance score?

The prototype deliberately excludes AI, automatic clinical decisions and nurse ranking. It records what happened and helps the nurse re-plan.

## 2. Planned study design (not yet run)

- **Participants:** 6–10 ICU nurses for formative usability, plus 1–2 head nurses for review/export feedback. Convenience sample; thesis demo.
- **Design:** within-subject, paper/shift-board baseline versus ICU TaskLog, counterbalanced order if the sample allows.
- **Tasks:** start a shift for six beds; identify the most critical open task; start and finish a task; log an interruption; handle an emergency on one bed; confirm deferred-task times; finalize a handover; end the shift; read the summary. Head nurse: find a shift, inspect the timeline, submit five manual ratings, export CSV.
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
| Domain tests | `./node_modules/.bin/vitest run` | **22 passed** |
| TypeScript | `./node_modules/.bin/tsc --noEmit` | clean |
| Product-rule lint | `npm run lint` | passed, 45 source files / 5 domain files |
| API integration | `npm run test:api` against Docker `postgres:16-alpine` | **19 checks passed** |
| Playwright auth/role/privacy | `npm run test:e2e` | **4 passed** |
| Web build | `npm run build` | success; all app routes + `ƒ /api/[[...route]]` |
| Mobile build | `npm run build:mobile` | success; **17 static pages**, no API route; `src/app/api` restored |
| Full nurse flow | `node scripts/flow-check.mjs` | emergency banner, 4 reschedule proposals confirmed, task timer/finish, quick add, handover finalized, shift ended, no active shift |
| Demo data | `npm run simulate:reset` | 14 finished shifts, 1,369 events, 28 handovers, 11 reviews, 9 surveys |
| Head analytics | `GET /api/analytics/unit?days=30` | 14 shifts, completion 79.4%, tier 1–2 on-time 59.1%, direct care 4h 18m, indirect 1h 6m, interruptions 44m, emergency 8m |
| Live health | `GET https://icu-tasklog.vercel.app/api/health` | **200**; `{"ok":true,"database":true}` |
| Live login | `POST /api/auth/login` on Vercel | **200** for `amina/1111` and `head/9999`; role returned in `user.role` |
| Live head analytics | `GET /api/analytics/unit` on Vercel | **200**; 14 shifts |
| Live CORS preflight | `OPTIONS /api/auth/login`, `Origin: https://localhost` | **204**; `access-control-allow-origin: https://localhost` |
| Android CI build | GitHub Actions run `43297872952` | **success**; `app-debug.apk`, 5,598,974 bytes, SHA-256 `5a3526110693912b8c19b64b93038f63cb605ee9185329ecbb48a07855de30b9` |

### Production deployment

- Web/API: <https://icu-tasklog.vercel.app> — one Vercel Next.js project; `/api/*` is served by the mounted Hono app.
- Observed checks: health 200, nurse and head login 200, head analytics 200, CORS preflight 204.
- Android artifact: GitHub Actions run `43297872952` succeeded. The `icu-tasklog-debug-apk` artifact contains `app-debug.apk` (5,598,974 bytes, SHA-256 above).
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
- **Small single-centre sample.** Results will not generalise.
- **Neon/network variability.** Transient DNS/timeouts were observed locally; nurse actions remain in Dexie, but login and head screens need connectivity.
- **On-device APK behaviour is not measured.** The Vercel deployment and the GitHub Actions APK build were observed, but the APK was not installed or opened on a physical Android device in this workspace.
- **Demo backdating** makes overdue states visible immediately; it is not a real shift timestamp and is labelled in the UI.

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
