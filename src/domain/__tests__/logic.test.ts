import { describe, expect, it } from "vitest";
import {
  DEFAULT_CONFIG,
  DomainError,
  buildHandover,
  buildShiftSummary,
  computeDurations,
  confirmReschedule,
  endEmergency,
  isMissed,
  nextRecurringTask,
  proposeReschedule,
  reduce,
  scoreRawTLX,
  scoreSUS,
  sortTasks,
  startEmergency,
  type DomainEvent,
  type Task,
} from "../index";

const T0 = Date.UTC(2026, 0, 10, 7, 0, 0);
const MIN = 60_000;
const actorId = "nurse-1";
const shiftId = "shift-1";
const bedId = "bed-1";

let seq = 0;
function ev<T extends DomainEvent["type"]>(
  type: T,
  ts: number,
  overrides: Partial<Extract<DomainEvent, { type: T }>> = {},
): Extract<DomainEvent, { type: T }> {
  seq += 1;
  const base = {
    id: `e${seq}`,
    shiftId,
    bedId,
    actorId,
    type,
    clientTs: ts,
    payload: {},
  };
  return { ...base, ...overrides } as Extract<DomainEvent, { type: T }>;
}

function created(taskId: string, tier: 1 | 2 | 3 | 4, dueAt: number, ts = T0, extra = {}) {
  return ev("TASK_CREATED", ts, {
    taskId,
    bedId,
    payload: {
      title: `Task ${taskId}`,
      category: tier === 4 ? "indirect_care" : "direct_care",
      tier,
      dueAt,
      expectedMin: 10,
      ...extra,
    },
  });
}

function started(taskId: string, ts: number) {
  return ev("TASK_STARTED", ts, { taskId, bedId, payload: {} });
}
function paused(taskId: string, ts: number) {
  return ev("TASK_PAUSED", ts, { taskId, bedId, payload: {} });
}
function resumed(taskId: string, ts: number) {
  return ev("TASK_RESUMED", ts, { taskId, bedId, payload: {} });
}
function completed(taskId: string, ts: number, tickOnly = false) {
  return ev("TASK_COMPLETED", ts, { taskId, bedId, payload: { tickOnly } });
}
function missed(taskId: string, ts: number, reason: "timeout" | "shift_end" = "timeout") {
  return ev("TASK_MISSED", ts, { taskId, bedId, payload: { reason } });
}
function deferred(taskId: string, ts: number) {
  return ev("TASK_DEFERRED", ts, { taskId, bedId, payload: { reason: "emergency" } });
}
function rescheduled(taskId: string, ts: number, dueAt: number) {
  return ev("TASK_RESCHEDULED", ts, { taskId, bedId, payload: { dueAt, reason: "emergency" } });
}

function shiftEvents(extra: DomainEvent[]): DomainEvent[] {
  return [
    ev("SHIFT_STARTED", T0, { payload: { shiftType: "day" } }),
    ...extra,
    ev("SHIFT_ENDED", T0 + 60 * MIN, { payload: {} }),
  ];
}

describe("sortTasks", () => {
  const base: Task = {
    id: "a",
    shiftId,
    bedId,
    title: "A",
    category: "direct_care",
    tier: 2,
    status: "planned",
    dueAt: T0 + 20 * MIN,
    expectedMin: 5,
    createdAt: T0,
    durationRecorded: false,
    pinned: false,
    needsAttention: false,
  };

  it("orders pinned first, then tier, then most overdue, then earliest due, with stable ties", () => {
    const tasks: Task[] = [
      { ...base, id: "t3", tier: 3, dueAt: T0 + 5 * MIN },
      { ...base, id: "t2-late", tier: 2, dueAt: T0 + 1 * MIN },
      { ...base, id: "t2-early", tier: 2, dueAt: T0 + 10 * MIN },
      { ...base, id: "t2-tie-a", tier: 2, dueAt: T0 + 3 * MIN },
      { ...base, id: "t2-tie-b", tier: 2, dueAt: T0 + 3 * MIN },
      { ...base, id: "pinned", tier: 4, pinned: true, dueAt: T0 + 100 * MIN },
      { ...base, id: "t1", tier: 1, dueAt: T0 + 12 * MIN },
    ];
    const sorted = sortTasks(tasks, T0 + 4 * MIN).map((t) => t.id);
    expect(sorted).toEqual(["pinned", "t1", "t2-late", "t2-tie-a", "t2-tie-b", "t2-early", "t3"]);
  });
});

describe("state machine", () => {
  it("rejects invalid transitions", () => {
    const events = [
      created("x", 1, T0 + 5 * MIN),
      started("x", T0),
      paused("x", T0 + MIN),
      started("x", T0 + 2 * MIN),
    ];
    expect(() => reduce(events)).toThrow(DomainError);
  });

  it("rejects starting a deferred task without an explicit reschedule", () => {
    const events = [
      created("x", 3, T0 + 5 * MIN),
      deferred("x", T0),
      started("x", T0 + MIN),
    ];
    expect(() => reduce(events)).toThrow(DomainError);
  });

  it("allows tick-only completion but records no duration", () => {
    const events = [created("x", 4, T0), completed("x", T0 + MIN, true)];
    const state = reduce(events);
    expect(state.tasks.x.status).toBe("done");
    expect(state.tasks.x.durationRecorded).toBe(false);
    expect(computeDurations(events).byTask.x.minutes).toBe(0);
  });

  it("requires tickOnly for completion from planned", () => {
    const events = [created("x", 4, T0), completed("x", T0 + MIN, false)];
    expect(() => reduce(events)).toThrow(DomainError);
  });
});

describe("priority protection and emergency", () => {
  it("never defers tier 1 or tier 2", () => {
    for (const tier of [1, 2] as const) {
      const events = [created("x", tier, T0), deferred("x", T0 + MIN)];
      expect(() => reduce(events)).toThrow(/never be deferred/);
    }
  });

  it("only defers planned tier 3-4 and flags tier 1-2 on the emergency bed", () => {
    const tasks: Task[] = [
      {
        id: "t1",
        shiftId,
        bedId,
        title: "Vent",
        category: "direct_care",
        tier: 1,
        status: "planned",
        dueAt: T0,
        expectedMin: 5,
        createdAt: T0,
        durationRecorded: false,
        pinned: false,
        needsAttention: false,
      },
      {
        id: "t2",
        shiftId,
        bedId,
        title: "Meds",
        category: "direct_care",
        tier: 2,
        status: "in_progress",
        dueAt: T0,
        expectedMin: 5,
        createdAt: T0,
        startedAt: T0,
        durationRecorded: false,
        pinned: false,
        needsAttention: false,
      },
      {
        id: "t3",
        shiftId,
        bedId,
        title: "Reposition",
        category: "direct_care",
        tier: 3,
        status: "planned",
        dueAt: T0,
        expectedMin: 5,
        createdAt: T0,
        durationRecorded: false,
        pinned: false,
        needsAttention: false,
      },
      {
        id: "t4",
        shiftId,
        bedId,
        title: "Charting",
        category: "indirect_care",
        tier: 4,
        status: "planned",
        dueAt: T0,
        expectedMin: 5,
        createdAt: T0,
        durationRecorded: false,
        pinned: false,
        needsAttention: false,
      },
    ];
    const plan = startEmergency({ shiftId, bedId, actorId, tasks }, T0 + 10 * MIN, "emg");
    expect(plan.pausedTaskIds).toEqual(["t2"]);
    expect(plan.deferredTaskIds).toEqual(["t3", "t4"]);
    expect(plan.flaggedTaskIds.sort()).toEqual(["t1", "t2"]);

    const events = [
      created("t1", 1, T0),
      created("t2", 2, T0),
      created("t3", 3, T0),
      created("t4", 4, T0),
      started("t2", T0),
      ...plan.events,
    ];
    const state = reduce(events);
    expect(state.tasks.t1.status).toBe("planned");
    expect(state.tasks.t1.needsAttention).toBe(true);
    expect(state.tasks.t2.status).toBe("paused");
    expect(state.tasks.t2.needsAttention).toBe(true);
    expect(state.tasks.t3.status).toBe("deferred");
    expect(state.tasks.t4.status).toBe("deferred");
    expect(state.emergencies[0].startedAt).toBe(T0 + 10 * MIN);
  });

  it("proposes due dates shifted by the emergency duration and requires confirmation", () => {
    const deferredTasks: Task[] = [
      {
        id: "d1",
        shiftId,
        bedId,
        title: "Oral care",
        category: "direct_care",
        tier: 3,
        status: "deferred",
        dueAt: T0 + 5 * MIN,
        expectedMin: 5,
        createdAt: T0,
        durationRecorded: false,
        pinned: false,
        needsAttention: false,
      },
      {
        id: "d2",
        shiftId,
        bedId,
        title: "Charting",
        category: "indirect_care",
        tier: 4,
        status: "deferred",
        dueAt: T0 + 10 * MIN,
        expectedMin: 5,
        createdAt: T0,
        durationRecorded: false,
        pinned: false,
        needsAttention: false,
      },
    ];
    const emergency = {
      id: "emg",
      shiftId,
      bedId,
      startedAt: T0 + 15 * MIN,
    };
    const end = endEmergency(emergency, deferredTasks, T0 + 55 * MIN, actorId);
    expect(end.durationMs).toBe(40 * MIN);
    expect(end.proposals).toEqual([
      { taskId: "d1", title: "Oral care", oldDue: T0 + 5 * MIN, newDue: T0 + 45 * MIN },
      { taskId: "d2", title: "Charting", oldDue: T0 + 10 * MIN, newDue: T0 + 50 * MIN },
    ]);
    const confirm = confirmReschedule(deferredTasks[0], end.proposals[0], T0 + 56 * MIN, actorId);
    expect(confirm.type).toBe("TASK_RESCHEDULED");
    expect((confirm as Extract<DomainEvent, { type: "TASK_RESCHEDULED" }>).payload.dueAt).toBe(
      T0 + 45 * MIN,
    );

    const fixed = proposeReschedule(deferredTasks, T0, T0 + 40 * MIN, {
      ...DEFAULT_CONFIG,
      rescheduleOffsetMode: "fixed",
      fixedOffsetMin: 15,
    });
    expect(fixed[0].newDue).toBe(T0 + 20 * MIN);
  });

  it("does not reschedule until the nurse confirms", () => {
    const plans = proposeReschedule(
      [
        {
          id: "d1",
          shiftId,
          bedId,
          title: "Oral care",
          category: "direct_care",
          tier: 3,
          status: "deferred",
          dueAt: T0,
          expectedMin: 5,
          createdAt: T0,
          durationRecorded: false,
          pinned: false,
          needsAttention: false,
        },
      ],
      T0,
      T0 + 30 * MIN,
    );
    const events = [created("d1", 3, T0), deferred("d1", T0)];
    expect(reduce(events).tasks.d1.status).toBe("deferred");
    expect(plans).toHaveLength(1);
    const afterConfirm = reduce([
      ...events,
      confirmReschedule(reduce(events).tasks.d1, plans[0], T0 + 40 * MIN, actorId),
    ]);
    expect(afterConfirm.tasks.d1.status).toBe("planned");
    expect(afterConfirm.tasks.d1.dueAt).toBe(T0 + 30 * MIN);
  });
});

describe("durations and corrections", () => {
  it("sums multiple pause/resume segments", () => {
    const events = [
      created("x", 1, T0),
      started("x", T0),
      paused("x", T0 + 10 * MIN),
      resumed("x", T0 + 20 * MIN),
      paused("x", T0 + 30 * MIN),
      resumed("x", T0 + 40 * MIN),
      completed("x", T0 + 50 * MIN),
    ];
    expect(computeDurations(events).byTask.x.minutes).toBe(30);
  });

  it("uses timestamps only, so wall-clock sleep does not inflate durations", () => {
    const events = [
      created("x", 1, T0),
      started("x", T0),
      completed("x", T0 + 12 * MIN),
    ];
    const first = computeDurations(events).byTask.x.minutes;
    const later = computeDurations(events).byTask.x.minutes;
    expect(first).toBe(12);
    expect(later).toBe(12);
  });

  it("applies the latest correction while preserving the original event", () => {
    const start = started("x", T0);
    const end = completed("x", T0 + 10 * MIN);
    const correction = ev("TIME_CORRECTED", T0 + 20 * MIN, {
      payload: { targetEventId: end.id, newTs: T0 + 20 * MIN },
    });
    const events = [created("x", 1, T0), start, end, correction];
    expect(computeDurations(events).byTask.x.minutes).toBe(20);
    expect(reduce(events).tasks.x.completedAt).toBe(T0 + 20 * MIN);
    expect(end.clientTs).toBe(T0 + 10 * MIN);
    expect(correction.payload.newTs).toBe(T0 + 20 * MIN);
    expect(events).toHaveLength(4);
  });

  it("lets a later correction supersede an earlier one", () => {
    const end = completed("x", T0 + 10 * MIN);
    const c1 = ev("TIME_CORRECTED", T0 + 11 * MIN, {
      payload: { targetEventId: end.id, newTs: T0 + 15 * MIN },
    });
    const c2 = ev("TIME_CORRECTED", T0 + 12 * MIN, {
      payload: { targetEventId: end.id, newTs: T0 + 25 * MIN },
    });
    expect(
      computeDurations([created("x", 1, T0), started("x", T0), end, c1, c2]).byTask.x.minutes,
    ).toBe(25);
  });

  it("splits direct, indirect, interruption and emergency minutes", () => {
    const events = [
      created("direct", 2, T0),
      started("direct", T0),
      completed("direct", T0 + 10 * MIN),
      created("indirect", 4, T0),
      started("indirect", T0 + 10 * MIN),
      completed("indirect", T0 + 25 * MIN),
      ev("INTERRUPTION_LOGGED", T0 + 30 * MIN, {
        taskId: "direct",
        payload: {
          reason: "physician_request",
          startedAt: T0 + 25 * MIN,
          endedAt: T0 + 30 * MIN,
        },
      }),
      ev("EMERGENCY_STARTED", T0 + 30 * MIN, { bedId }),
      ev("EMERGENCY_ENDED", T0 + 40 * MIN, { bedId }),
    ];
    const d = computeDurations(events);
    expect(d.directCareMin).toBe(10);
    expect(d.indirectCareMin).toBe(15);
    expect(d.interruptionMin).toBe(5);
    expect(d.emergencyMin).toBe(10);
    expect(d.interruptionsByReason.physician_request).toEqual({ count: 1, minutes: 5 });
  });
});

describe("missed tasks and recurring tasks", () => {
  it("marks a not-started task missed only after the timeout", () => {
    const task: Task = {
      id: "x",
      shiftId,
      bedId,
      title: "Vitals",
      category: "direct_care",
      tier: 2,
      status: "planned",
      dueAt: T0,
      expectedMin: 5,
      createdAt: T0,
      durationRecorded: false,
      pinned: false,
      needsAttention: false,
    };
    expect(isMissed(task, T0 + 29 * MIN, DEFAULT_CONFIG)).toBe(false);
    expect(isMissed(task, T0 + 31 * MIN, DEFAULT_CONFIG)).toBe(true);
    expect(isMissed(task, T0 + MIN, DEFAULT_CONFIG, T0 + 2 * MIN)).toBe(true);
  });

  it("creates the next recurring instance from completion time + interval", () => {
    const task: Task = {
      id: "x",
      shiftId,
      bedId,
      title: "Vitals",
      category: "direct_care",
      tier: 2,
      status: "done",
      dueAt: T0,
      expectedMin: 5,
      intervalMin: 60,
      createdAt: T0,
      durationRecorded: true,
      pinned: false,
      needsAttention: false,
    };
    const next = nextRecurringTask(task, T0 + 15 * MIN, actorId);
    expect(next?.type).toBe("TASK_CREATED");
    expect((next as Extract<DomainEvent, { type: "TASK_CREATED" }>).payload.dueAt).toBe(
      T0 + 75 * MIN,
    );
  });
});

describe("handover", () => {
  it("builds a bed handover from events and marks emergency minutes", () => {
    const events = [
      created("done", 2, T0),
      started("done", T0),
      completed("done", T0 + 5 * MIN),
      created("pending", 3, T0),
      created("deferred", 3, T0),
      deferred("deferred", T0),
      created("missed", 2, T0),
      missed("missed", T0 + 30 * MIN),
      ev("EMERGENCY_STARTED", T0 + 10 * MIN, { bedId }),
      ev("EMERGENCY_ENDED", T0 + 25 * MIN, { bedId }),
      ev("INTERRUPTION_LOGGED", T0 + 30 * MIN, {
        bedId,
        payload: {
          reason: "family_visitor",
          startedAt: T0 + 26 * MIN,
          endedAt: T0 + 30 * MIN,
        },
      }),
    ];
    const h = buildHandover(events, { id: bedId, label: "Bed 4, post-op" }, "Watch urine output");
    expect(h.done.map((t) => t.id)).toEqual(["done"]);
    expect(h.pending.map((t) => t.id)).toEqual(["pending"]);
    expect(h.deferred.map((t) => t.id)).toEqual(["deferred"]);
    expect(h.missed.map((t) => t.id)).toEqual(["missed"]);
    expect(h.interruptions).toEqual([
      { reason: "family_visitor", label: "Family / visitor", count: 1, minutes: 4 },
    ]);
    expect(h.emergencyMinutes).toBe(15);
    expect(h.note).toBe("Watch urine output");
    expect(h.bedLabel).toBe("Bed 4, post-op");
  });

  it("rejects revising a finalized handover", () => {
    const snapshot = buildHandover([created("x", 1, T0)], { id: bedId, label: "Bed 1" });
    const first = ev("HANDOVER_FINALIZED", T0 + MIN, {
      bedId,
      payload: { snapshot: snapshot as unknown as Record<string, unknown>, note: "" },
    });
    const second = ev("HANDOVER_FINALIZED", T0 + 2 * MIN, {
      bedId,
      payload: { snapshot: snapshot as unknown as Record<string, unknown>, note: "edited" },
    });
    expect(() => reduce([first, second])).toThrow(/immutable/);
  });
});

describe("shift summary", () => {
  it("matches a hand-built scenario", () => {
    const events = [
      ev("SHIFT_STARTED", T0, { payload: { shiftType: "day" } }),
      created("t1", 1, T0 + 10 * MIN),
      started("t1", T0 + 5 * MIN),
      completed("t1", T0 + 15 * MIN),
      created("t2", 2, T0 + 20 * MIN),
      started("t2", T0 + 15 * MIN),
      completed("t2", T0 + 19 * MIN),
      created("t3", 3, T0 + 30 * MIN),
      ev("EMERGENCY_STARTED", T0 + 20 * MIN, { bedId }),
      deferred("t3", T0 + 25 * MIN),
      ev("EMERGENCY_ENDED", T0 + 50 * MIN, { bedId }),
      rescheduled("t3", T0 + 50 * MIN, T0 + 50 * MIN),
      started("t3", T0 + 50 * MIN),
      completed("t3", T0 + 55 * MIN),
      created("t4", 2, T0 + 5 * MIN),
      missed("t4", T0 + 60 * MIN, "shift_end"),
      created("t5", 4, T0 + 30 * MIN),
      completed("t5", T0 + 30 * MIN, true),
      ev("INTERRUPTION_LOGGED", T0 + 35 * MIN, {
        bedId,
        payload: {
          reason: "alarm_device",
          startedAt: T0 + 30 * MIN,
          endedAt: T0 + 35 * MIN,
        },
      }),
      ev("SHIFT_ENDED", T0 + 60 * MIN, { payload: {} }),
    ];
    const s = buildShiftSummary(events);
    expect(s.directCareMin).toBe(19);
    expect(s.indirectCareMin).toBe(0);
    expect(s.interruptionMin).toBe(5);
    expect(s.emergencyMin).toBe(30);
    expect(s.tasksTotal).toBe(5);
    expect(s.tasksDone).toBe(4);
    expect(s.completionRate).toBe(0.8);
    expect(s.tier12OnTimeRate).toBeCloseTo(1 / 3);
    expect(s.missedCount).toBe(1);
    expect(s.deferredCount).toBe(0);
    expect(s.tierBreakdown[1]).toEqual({ total: 1, done: 1 });
    expect(s.tierBreakdown[2]).toEqual({ total: 2, done: 1 });
    expect(s.interruptionsByReason[0]).toMatchObject({ reason: "alarm_device", minutes: 5 });
    expect(s.totalMinutes).toBe(60);
  });
});

describe("survey scoring", () => {
  it("scores SUS against known examples", () => {
    expect(scoreSUS([5, 1, 5, 1, 5, 1, 5, 1, 5, 1])).toBe(100);
    expect(scoreSUS([1, 5, 1, 5, 1, 5, 1, 5, 1, 5])).toBe(0);
    expect(scoreSUS([5, 5, 5, 5, 5, 5, 5, 5, 5, 5])).toBe(50);
    expect(scoreSUS([4, 2, 4, 2, 4, 2, 4, 2, 4, 2])).toBe(75);
  });

  it("scores raw TLX as the mean of six sliders", () => {
    expect(scoreRawTLX([50, 50, 50, 50, 50, 50])).toBe(50);
    expect(scoreRawTLX([0, 20, 40, 60, 80, 100])).toBe(50);
    expect(scoreRawTLX([0, 0, 0, 0, 0, 100])).toBeCloseTo(16.67, 1);
  });

  it("rejects out-of-range answers", () => {
    expect(() => scoreSUS([5, 5])).toThrow();
    expect(() => scoreRawTLX([50, 50, 50, 50, 50, 101])).toThrow();
  });
});
