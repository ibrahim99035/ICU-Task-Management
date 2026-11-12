import "dotenv/config";
import { like } from "drizzle-orm";
import {
  buildHandover,
  buildShiftSummary,
  reduce,
  scoreRawTLX,
  scoreSUS,
  type DomainEvent,
  type HandoverSnapshot,
  type ShiftSummary,
  type Tier,
} from "../src/domain";
import { getDb, getPool, schema } from "../src/db";
import { DEMO_BEDS, DEMO_TEMPLATES } from "../src/lib/demo-data";

const db = getDb();
if (!db) throw new Error("DATABASE_URL is not configured");

const RESET = process.argv.includes("--reset");
const NOW = Date.now();
const HOUR = 3_600_000;
const MINUTE = 60_000;

const NURSES = [
  { id: "u-nurse-1", name: "Amina Hassan", code: "N01" },
  { id: "u-nurse-2", name: "Yara Saleh", code: "N02" },
  { id: "u-nurse-3", name: "Omar Khaled", code: "N03" },
];

const REVIEW_SCORES = [
  { completion: 5, critical_timeliness: 4, interruption_handling: 4, handover_quality: 5, documentation: 4 },
  { completion: 4, critical_timeliness: 4, interruption_handling: 3, handover_quality: 4, documentation: 4 },
  { completion: 3, critical_timeliness: 3, interruption_handling: 2, handover_quality: 3, documentation: 3 },
  { completion: 5, critical_timeliness: 5, interruption_handling: 4, handover_quality: 4, documentation: 5 },
];

function mulberry32(seed: number) {
  let value = seed;
  return () => {
    value |= 0;
    value = (value + 0x6d2b79f5) | 0;
    let t = Math.imul(value ^ (value >>> 15), 1 | value);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rng: () => number, list: T[]): T {
  return list[Math.floor(rng() * list.length)];
}

function roundMinute(ts: number) {
  return Math.round(ts / MINUTE) * MINUTE;
}

async function cleanupSimulated() {
  await db!.delete(schema.surveyResponses).where(like(schema.surveyResponses.id, "sim-survey-%"));
  await db!.delete(schema.shiftReviews).where(like(schema.shiftReviews.id, "sim-review-%"));
  await db!.delete(schema.handoverReports).where(like(schema.handoverReports.id, "sim-handover-%"));
  await db!.delete(schema.events).where(like(schema.events.id, "sim-%"));
  await db!.delete(schema.beds).where(like(schema.beds.id, "sim-%"));
  await db!.delete(schema.shifts).where(like(schema.shifts.id, "sim-%"));
}

type DraftShift = {
  id: string;
  userId: string;
  nurseName: string;
  participantCode: string;
  type: "day" | "night";
  startedAt: number;
  endedAt: number;
  seed: number;
};

async function main() {
  if (!RESET) {
    console.log("This script replaces only rows whose ids start with sim-. Use --reset to clear them first.");
  }

  const drafts: DraftShift[] = [];
  for (let dayOffset = 14; dayOffset >= 1; dayOffset -= 1) {
    const day = new Date(NOW - dayOffset * 24 * HOUR);
    const dateKey = `${day.getFullYear()}${String(day.getMonth() + 1).padStart(2, "0")}${String(day.getDate()).padStart(2, "0")}`;
    const nurse = NURSES[dayOffset % NURSES.length];
    const night = dayOffset % 3 === 0;
    const startedAt = new Date(day.getFullYear(), day.getMonth(), day.getDate(), night ? 19 : 7, 0).getTime();
    const endedAt = startedAt + 8 * HOUR;
    if (endedAt >= NOW) continue;
    drafts.push({
      id: `sim-${dateKey}-${nurse.id}`,
      userId: nurse.id,
      nurseName: nurse.name,
      participantCode: nurse.code,
      type: night ? "night" : "day",
      startedAt,
      endedAt,
      seed: Number(`${dayOffset}${nurse.code.slice(1)}`),
    });
  }

  if (RESET) await cleanupSimulated();

  const allEvents: (DomainEvent & { serverTs: number })[] = [];
  const allBeds: { id: string; shiftId: string; label: string; alias: string }[] = [];
  const allHandovers: { id: string; shiftId: string; bedId: string; snapshot: HandoverSnapshot; createdAt: number }[] = [];
  const allReviews: {
    id: string;
    shiftId: string;
    nurseId: string;
    reviewerId: string;
    scores: Record<string, number>;
    comment: string;
    needsSupport: boolean;
    createdAt: number;
  }[] = [];
  const shiftRows: {
    id: string;
    userId: string;
    type: string;
    startedAt: number;
    endedAt: number;
    summary: ShiftSummary;
  }[] = [];

  for (let index = 0; index < drafts.length; index += 1) {
    const draft = drafts[index];
    const rng = mulberry32(draft.seed);
    let eventNumber = 0;
    const events: DomainEvent[] = [];
    const shiftId = draft.id;
    const actorId = draft.userId;

    const makeEvent = (
      type: DomainEvent["type"],
      at: number,
      opts: { bedId?: string; taskId?: string; payload: Record<string, unknown> },
    ) =>
      ({
        id: `${shiftId}-e-${String(++eventNumber).padStart(4, "0")}`,
        shiftId,
        bedId: opts.bedId,
        taskId: opts.taskId,
        actorId,
        type,
        payload: opts.payload,
        clientTs: roundMinute(at),
      }) as DomainEvent;

    const bedChoices = [...DEMO_BEDS].sort(() => rng() - 0.5).slice(0, 4 + Math.floor(rng() * 3));
    const beds = bedChoices.map((bed) => ({
      ...bed,
      id: `${shiftId}-${bed.id}`,
    }));
    for (const bed of beds) {
      allBeds.push({ id: bed.id, shiftId, label: bed.label, alias: bed.alias });
    }

    events.push(
      makeEvent("SHIFT_STARTED", draft.startedAt, {
        payload: { shiftType: draft.type, bedLabels: beds.map((bed) => bed.alias), note: "Simulated teaching shift" },
      }),
    );

    const emergencyBed = rng() < 0.45 ? pick(rng, beds) : undefined;
    const emergencyStart = emergencyBed ? draft.startedAt + 2.5 * HOUR + rng() * 2 * HOUR : undefined;
    const emergencyMinutes = 8 + Math.floor(rng() * 18);
    const emergencyEnd = emergencyStart ? emergencyStart + emergencyMinutes * MINUTE : undefined;

    if (emergencyBed && emergencyStart !== undefined && emergencyEnd !== undefined) {
      events.push(
        makeEvent("EMERGENCY_STARTED", emergencyStart, {
          bedId: emergencyBed.id,
          payload: { note: "Simulated rapid response / bedside emergency" },
        }),
      );
      events.push(
        makeEvent("EMERGENCY_ENDED", emergencyEnd, {
          bedId: emergencyBed.id,
          payload: { note: "Emergency resolved; deferred tasks need new times" },
        }),
      );
    }

    for (const bed of beds) {
      const templates = [...DEMO_TEMPLATES]
        .filter((template) => bed.templateIds.includes(template.id))
        .slice(0, 6);

      for (const template of templates) {
        const taskId = `${shiftId}-${bed.id}-${template.id}`;
        const dueAt = roundMinute(draft.startedAt + (template.offsetMin + 20) * MINUTE);
        events.push(
          makeEvent("TASK_CREATED", draft.startedAt + 2 * MINUTE, {
            bedId: bed.id,
            taskId,
            payload: {
              title: template.name,
              category: template.category,
              tier: template.tier,
              dueAt,
              expectedMin: template.expectedMin,
              intervalMin: template.intervalMin,
              templateId: template.id,
              bedLabel: bed.label,
            },
          }),
        );

        const roll = rng();
        const tier = template.tier as Tier;
        const duration = Math.max(3, Math.round(template.expectedMin * (0.75 + rng() * 0.9)));

        if (roll < 0.07) {
          events.push(
            makeEvent("TASK_COMPLETED", roundMinute(dueAt + rng() * 4 * MINUTE), {
              bedId: bed.id,
              taskId,
              payload: { tickOnly: true },
            }),
          );
          continue;
        }

        if (roll < 0.16 && tier >= 3) {
          const at = emergencyStart ?? dueAt + 10 * MINUTE;
          events.push(
            makeEvent("TASK_DEFERRED", roundMinute(at), {
              bedId: bed.id,
              taskId,
              payload: { reason: emergencyBed ? "emergency" : "other", note: "Simulated deferral" },
            }),
          );
          continue;
        }

        if (roll < 0.28) {
          events.push(
            makeEvent("TASK_MISSED", draft.endedAt - 20 * MINUTE, {
              bedId: bed.id,
              taskId,
              payload: { reason: "shift_end" },
            }),
          );
          continue;
        }

        const onTime = rng() < (tier <= 2 ? 0.78 : 0.56);
        let completedAt = onTime
          ? roundMinute(dueAt - rng() * 6 * MINUTE)
          : roundMinute(dueAt + (2 + rng() * 16) * MINUTE);
        completedAt = Math.max(draft.startedAt + 10 * MINUTE, Math.min(draft.endedAt - 25 * MINUTE, completedAt));
        let startedAt = roundMinute(completedAt - duration * MINUTE);
        startedAt = Math.max(draft.startedAt + 5 * MINUTE, startedAt);

        events.push(makeEvent("TASK_STARTED", startedAt, { bedId: bed.id, taskId, payload: {} }));

        if (rng() < 0.18 && completedAt - startedAt > 14 * MINUTE) {
          const pauseAt = roundMinute(startedAt + 3 * MINUTE);
          const resumeAt = roundMinute(pauseAt + (3 + rng() * 4) * MINUTE);
          if (resumeAt < completedAt - 2 * MINUTE) {
            events.push(makeEvent("TASK_PAUSED", pauseAt, { bedId: bed.id, taskId, payload: { reason: "Interruption" } }));
            events.push(makeEvent("TASK_RESUMED", resumeAt, { bedId: bed.id, taskId, payload: {} }));
          }
        }

        events.push(
          makeEvent("TASK_COMPLETED", Math.max(startedAt + MINUTE, completedAt), {
            bedId: bed.id,
            taskId,
            payload: {},
          }),
        );
      }
    }

    const interruptionReasons = ["physician_request", "missing_equipment", "family_visitor", "alarm_device", "other_staff"] as const;
    const interruptionCount = 2 + Math.floor(rng() * 4);
    for (let i = 0; i < interruptionCount; i += 1) {
      const at = draft.startedAt + (1 + rng() * 6) * HOUR;
      const minutes = 4 + Math.floor(rng() * 22);
      const bed = pick(rng, beds);
      events.push(
        makeEvent("INTERRUPTION_LOGGED", at, {
          bedId: bed.id,
          payload: {
            reason: pick(rng, [...interruptionReasons]),
            startedAt: roundMinute(at),
            endedAt: roundMinute(at + minutes * MINUTE),
            note: "Simulated interruption",
          },
        }),
      );
    }

    // Freeze unfinished work as missed, as the shift-end action does.
    const reduced = reduce(events);
    for (const task of Object.values(reduced.tasks)) {
      if (task.status === "planned" || task.status === "in_progress" || task.status === "paused") {
        events.push(
          makeEvent("TASK_MISSED", draft.endedAt - 15 * MINUTE, {
            bedId: task.bedId,
            taskId: task.id,
            payload: { reason: "shift_end" },
          }),
        );
      }
    }

    // Two finalized handovers per shift.
    for (const bed of beds.slice(0, 2)) {
      const snapshot = buildHandover(events, { id: bed.id, label: bed.alias }, "", draft.endedAt - 5 * MINUTE);
      snapshot.note =
        index % 2 === 0
          ? "Watch the airway plan and family update. Deferred care still needs a new time."
          : "Continue hourly checks. Handover note is simulated practice text.";
      events.push(
        makeEvent("HANDOVER_FINALIZED", draft.endedAt - 5 * MINUTE, {
          bedId: bed.id,
          payload: { note: snapshot.note, snapshot },
        }),
      );
      allHandovers.push({
        id: `sim-handover-${shiftId}-${bed.id}`,
        shiftId,
        bedId: bed.id,
        snapshot,
        createdAt: draft.endedAt - 5 * MINUTE,
      });
    }

    events.push(makeEvent("SHIFT_ENDED", draft.endedAt, { payload: { note: "Simulated shift end" } }));

    const summary = buildShiftSummary(events, draft.endedAt);
    shiftRows.push({
      id: shiftId,
      userId: draft.userId,
      type: draft.type,
      startedAt: draft.startedAt,
      endedAt: draft.endedAt,
      summary,
    });
    allEvents.push(...(events as (DomainEvent & { serverTs: number })[]).map((event) => ({ ...event, serverTs: event.clientTs })));

    if (index % 4 !== 3) {
      const scores = { ...REVIEW_SCORES[index % REVIEW_SCORES.length] };
      allReviews.push({
        id: `sim-review-${shiftId}`,
        shiftId,
        nurseId: draft.userId,
        reviewerId: "u-head-1",
        scores,
        comment:
          index % 3 === 0
            ? "Clear priority protection. Keep naming the interruption reason when you pause."
            : "Good handover structure. Check the deferred list before the next shift.",
        needsSupport: index % 6 === 2,
        createdAt: draft.endedAt + 30 * MINUTE,
      });
    }
  }

  // Insert shifts, beds, events, handovers and reviews.
  for (const shift of shiftRows) {
    await db!
      .insert(schema.shifts)
      .values(shift)
      .onConflictDoUpdate({
        target: schema.shifts.id,
        set: { endedAt: shift.endedAt, summary: shift.summary },
      });
  }
  for (const bed of allBeds) {
    await db!.insert(schema.beds).values(bed).onConflictDoNothing();
  }
  for (let i = 0; i < allEvents.length; i += 200) {
    await db!.insert(schema.events).values(allEvents.slice(i, i + 200)).onConflictDoNothing();
  }
  for (const handover of allHandovers) {
    await db!.insert(schema.handoverReports).values(handover).onConflictDoNothing();
  }
  for (const review of allReviews) {
    await db!.insert(schema.shiftReviews).values(review).onConflictDoNothing();
  }

  // Seeded evaluation surveys: three nurses and the head nurse, paper vs app.
  const susApp = [5, 2, 5, 1, 4, 2, 5, 1, 5, 2];
  const susPaper = [4, 3, 4, 2, 3, 3, 4, 2, 4, 2];
  const tlx = [55, 40, 60, 45, 58, 35];
  const surveys = [
    { user: NURSES[0], instrument: "SUS", phase: "paper", answers: susPaper, daysAgo: 9 },
    { user: NURSES[0], instrument: "SUS", phase: "app", answers: susApp, daysAgo: 4 },
    { user: NURSES[0], instrument: "TLX", phase: "app", answers: tlx, daysAgo: 4 },
    { user: NURSES[1], instrument: "SUS", phase: "paper", answers: susPaper, daysAgo: 8 },
    { user: NURSES[1], instrument: "SUS", phase: "app", answers: [5, 1, 4, 2, 5, 2, 4, 1, 5, 1], daysAgo: 3 },
    { user: NURSES[1], instrument: "TLX", phase: "app", answers: [48, 35, 55, 40, 50, 30], daysAgo: 3 },
    { user: NURSES[2], instrument: "SUS", phase: "app", answers: [4, 2, 4, 2, 4, 2, 4, 2, 4, 2], daysAgo: 2 },
    { user: NURSES[2], instrument: "TLX", phase: "app", answers: [62, 44, 66, 52, 60, 42], daysAgo: 2 },
    { user: { id: "u-head-1", code: "H01" }, instrument: "SUS", phase: "app", answers: [5, 1, 5, 1, 5, 1, 5, 1, 5, 1], daysAgo: 1 },
  ];
  for (let i = 0; i < surveys.length; i += 1) {
    const survey = surveys[i];
    const score = survey.instrument === "SUS" ? scoreSUS(survey.answers) : scoreRawTLX(survey.answers);
    await db!
      .insert(schema.surveyResponses)
      .values({
        id: `sim-survey-${i}`,
        userId: survey.user.id,
        participantCode: survey.user.code,
        instrument: survey.instrument,
        phase: survey.phase,
        answers: survey.answers,
        score: String(Math.round(score * 10) / 10),
        takenAt: NOW - survey.daysAgo * 24 * HOUR,
      })
      .onConflictDoUpdate({ target: schema.surveyResponses.id, set: { score: String(Math.round(score * 10) / 10), answers: survey.answers } });
  }

  console.log(`Simulated ${shiftRows.length} finished shifts, ${allEvents.length} events, ${allHandovers.length} handovers, ${allReviews.length} reviews, ${surveys.length} surveys.`);
  console.log("All data uses participant codes and bed labels only. Simulation is deterministic.");
  await getPool().end();
}

main().catch(async (error) => {
  console.error(error);
  await getPool().end();
  process.exit(1);
});
