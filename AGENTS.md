# ICU TaskLog — working rules

ICU TaskLog is a thesis demo for ICU nurses. It plans and logs practice tasks. It is **not** a medical device and does not replace bedside monitors, alarms or official orders.

## Non-negotiable product rules

- Roles: `nurse` and `head_nurse` only.
- No patient identifiers: no names, MRNs, IDs, dates of birth, photos. Beds are number + short free-text nickname only. The UI warns users not to type identifiers.
- Rule-based logic only. No AI/ML.
- Tier 1 and tier 2 tasks must never be deferred automatically.
- No computed performance score, ranking or leaderboard. Head-nurse ratings are five manual 1–5 criteria.
- Fully offline nurse flow: every action is written to Dexie first and synced later.
- Durations are computed from stored timestamps, never from in-memory counters.
- The disclaimer is visible throughout the app.
- Out of scope: EHR/order integration, biometric/OAuth login, push notifications, iOS, Arabic/RTL, admin screens, template editor UI, weighted TLX, TAM, AI.

## Architecture (current decision)

The original brief asked for a monorepo with a static-export mobile app and a separate Hono API. The project owner then required **one Next.js full-stack project on Vercel**. That later instruction wins:

- One Next.js App Router project at the repo root.
- Hono is mounted in `src/app/api/[[...route]]/route.ts`.
- Drizzle ORM + Neon PostgreSQL.
- Domain rules live in `src/domain` (pure TypeScript, unit-tested).
- Web deployment: normal Next.js full-stack build on Vercel.
- APK: the same project built with `NEXT_BUILD_TARGET=mobile`, which emits a static export and bundles it in Capacitor. It calls the Vercel API. No `server.url`.
- No separate hosted API project.

## Evidence rules

- Never claim something works unless it was run and the output was observed.
- Mark missing SDK/emulator/deployment evidence as **NOT VERIFIED**.
- Do not weaken tests to make them pass.
- Record assumptions in `ASSUMPTIONS.md`.
