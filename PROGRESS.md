# Progress

## P1 — Domain core (done)
- Pure TypeScript domain in `src/domain`.
- Zod event schema, reducer, state machine, emergency planning, rescheduling, timestamps-based durations, missed rule, recurring tasks, handover, shift summary, SUS/raw TLX.
- `22` Vitest tests passing: `./node_modules/.bin/vitest run`.
- Type-check clean: `./node_modules/.bin/tsc --noEmit`.

## Next
- P2: Dexie, use cases, nurse login/beds/tasks/timer.
- P3: interruptions and emergency UI.
- P4: handover and summary.
- P5: API/auth/sync/head nurse.
- P6: surveys/export/simulation.
- P7: polish, evaluation.
- P8: Capacitor APK.
