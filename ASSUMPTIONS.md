# Assumptions

1. **One Next.js full-stack project.** The project owner overrode the original monorepo/separate-API/static-web rules. Hono runs inside a Next.js route handler; Drizzle uses Neon.
2. **APK build.** The APK is a static export of the same project with API routes excluded from the mobile build. It bundles assets and calls the Vercel API. It does not use `server.url`.
3. **Emergency pauses all active timers** on the affected bed. Only *planned* tier 3–4 tasks are auto-deferred. Active tier 3–4 tasks are paused and remain for the nurse. Tier 1–2 tasks are never deferred; they are flagged `needsAttention` while the emergency is active.
4. **Reschedule default:** proposed due = old due + actual emergency duration. A fixed-offset mode exists in config. No `TASK_RESCHEDULED` event is written until the nurse confirms or edits the proposal.
5. **Recurring tasks:** the next instance is due at `completion time + intervalMin`. This guarantees a full interval after care is complete; the alternative (previous due + interval) would create instantly overdue work. One successor is created per completion.
6. **Shift end:** any still-open task becomes `missed` with reason `shift_end`; active segments are closed at the shift-end timestamp.
7. **Tick-only completion** (`planned → done`) is allowed with `durationRecorded=false` and contributes zero direct-care minutes.
8. **Pinning is local UI state**, not a clinical event. It is stored on the Dexie task projection and does not sync.
9. **Head-nurse screens are online-only** and show an explicit connection state. Nurse logging, timers, emergency handling and handover work offline.
10. **Offline login:** a previously authenticated nurse can continue logging while offline. Sync waits for a valid JWT; an expired token requires an online re-login.
11. **Survey identity:** staff `participant_code` is stored, never a patient identifier. SUS and raw TLX are the only instruments.
12. **Bed nicknames are free text.** The UI warns against patient names/identifiers and limits length, but rule-based validation cannot reliably detect a name. This remains a human-input risk and is listed in the evaluation.
13. **Demo content** (task templates, intervals, tiers) is illustrative and needs ICU clinical review.
14. **Charts:** the deployed bundle uses lightweight custom SVG/CSS charts instead of Recharts to keep the single-project build lean. The visual/interaction requirements remain.
15. **Tests:** domain tests run under Vitest. API tests use a disposable Postgres database via Docker. Playwright runs against the static export.
