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
  isShiftExpired,
  MAX_SHIFT_MS,
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

function created(
  taskId: string,
  tier: 1 | 2 | 3 | 4,
  plannedFrom: number,
  plannedTo: number,
  ts = T0,
  extra = {},
) {
  return ev("TASK_CREATED", ts, {
    taskId,
    bedId,
    payload: {
      title: `Task ${taskId}`,
      category: tier === 4 ? "indirect_care" : "direct_care",
      tier,
      plannedFrom,
      plannedTo,
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
function timeLogged(taskId: string, startedAt: number, endedAt: number, note?: string) {
  return ev("TASK_TIME_LOGGED", endedAt, {
    taskId,
    bedId,
    payload: { startedAt, endedAt, note },
  });
}
function rescheduled(taskId: string, ts: number, plannedFrom: number, plannedTo: number) {
  return ev("TASK_RESCHEDULED", ts, {
    taskId,
    bedId,
    payload: { plannedFrom, plannedTo, reason: "emergency" },
  });
}
function edited(
  taskId: string,
  ts: number,
  payload: {
    title?: string;
    tier?: 1 | 2 | 3 | 4;
    category?: "direct_care" | "indirect_care";
    plannedFrom?: number;
    plannedTo?: number;
    expectedMin?: number;
    note?: string;
  },
) {
  return ev("TASK_EDITED", ts, { taskId, bedId, payload });
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
    plannedFrom: T0 + 20 * MIN,
    plannedTo: T0 + 30 * MIN,
    expectedMin: 5,
    createdAt: T0,
    durationRecorded: false,
    pinned: false,
    needsAttention: false,
  };

  it("orders pinned first, then tier, then most overdue, then earliest due, with stable ties", () => {
    const tasks: Task[] = [
      { ...base, id: "t3", tier: 3, plannedFrom: T0 + 5 * MIN, plannedTo: T0 + 15 * MIN },
      { ...base, id: "t2-late", tier: 2, plannedFrom: T0 + 1 * MIN, plannedTo: T0 + 11 * MIN },
      { ...base, id: "t2-early", tier: 2, plannedFrom: T0 + 10 * MIN, plannedTo: T0 + 20 * MIN },
      { ...base, id: "t2-tie-a", tier: 2, plannedFrom: T0 + 3 * MIN, plannedTo: T0 + 13 * MIN },
      { ...base, id: "t2-tie-b", tier: 2, plannedFrom: T0 + 3 * MIN, plannedTo: T0 + 13 * MIN },
      { ...base, id: "pinned", tier: 4, pinned: true, plannedFrom: T0 + 100 * MIN, plannedTo: T0 + 110 * MIN },
      { ...base, id: "t1", tier: 1, plannedFrom: T0 + 12 * MIN, plannedTo: T0 + 22 * MIN },
    ];
    const sorted = sortTasks(tasks, T0 + 4 * MIN).map((t) => t.id);
    expect(sorted).toEqual(["pinned", "t1", "t2-late", "t2-tie-a", "t2-tie-b", "t2-early", "t3"]);
  });
});

describe("state machine", () => {
  it("rejects invalid transitions", () => {
    const events = [
      created("x", 1, T0 + 5 * MIN, T0 + 15 * MIN),
      started("x", T0),
      paused("x", T0 + MIN),
      started("x", T0 + 2 * MIN),
    ];
    expect(() => reduce(events)).toThrow(DomainError);
  });

  it("rejects starting a deferred task without an explicit reschedule", () => {
    const events = [
      created("x", 3, T0 + 5 * MIN, T0 + 15 * MIN),
      deferred("x", T0),
      started("x", T0 + MIN),
    ];
    expect(() => reduce(events)).toThrow(DomainError);
  });

  it("allows tick-only completion but records no duration", () => {
    const events = [created("x", 4, T0, T0 + 10 * MIN), completed("x", T0 + MIN, true)];
    const state = reduce(events);
    expect(state.tasks.x.status).toBe("done");
    expect(state.tasks.x.durationRecorded).toBe(false);
    expect(computeDurations(events).byTask.x.minutes).toBe(0);
  });

  it("requires tickOnly for completion from planned", () => {
    const events = [created("x", 4, T0, T0 + 10 * MIN), completed("x", T0 + MIN, false)];
    expect(() => reduce(events)).toThrow(DomainError);
  });

  it("edits an unfinished task and keeps a note", () => {
    const events = [
      created("x", 2, T0, T0 + 10 * MIN),
      edited("x", T0 + MIN, {
        title: "Updated vital signs",
        tier: 3,
        category: "indirect_care",
        plannedFrom: T0 + 20 * MIN,
        plannedTo: T0 + 35 * MIN,
        expectedMin: 15,
        note: "Recheck after the family update.",
      }),
    ];
    const task = reduce(events).tasks.x;
    expect(task.title).toBe("Updated vital signs");
    expect(task.tier).toBe(3);
    expect(task.category).toBe("indirect_care");
    expect(task.plannedFrom).toBe(T0 + 20 * MIN);
    expect(task.plannedTo).toBe(T0 + 35 * MIN);
    expect(task.expectedMin).toBe(15);
    expect(task.note).toBe("Recheck after the family update.");
  });

  it("rejects editing a finished task", () => {
    const events = [
      created("x", 4, T0, T0 + 10 * MIN),
      completed("x", T0 + MIN, true),
      edited("x", T0 + 2 * MIN, { note: "Too late" }),
    ];
    expect(() => reduce(events)).toThrow(/cannot be altered/);
  });

  it("rejects an edited window that ends before it starts", () => {
    const events = [
      created("x", 3, T0, T0 + 10 * MIN),
      edited("x", T0 + MIN, { plannedFrom: T0 + 20 * MIN, plannedTo: T0 + 15 * MIN }),
    ];
    expect(() => reduce(events)).toThrow(/cannot be before/);
  });
});

describe("priority protection and emergency", () => {
  it("never defers tier 1 or tier 2", () => {
    for (const tier of [1, 2] as const) {
      const events = [created("x", tier, T0, T0 + 10 * MIN), deferred("x", T0 + MIN)];
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
        plannedFrom: T0,
        plannedTo: T0 + 10 * MIN,
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
        plannedFrom: T0,
        plannedTo: T0 + 10 * MIN,
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
        plannedFrom: T0,
        plannedTo: T0 + 10 * MIN,
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
        plannedFrom: T0,
        plannedTo: T0 + 10 * MIN,
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
      created("t1", 1, T0, T0 + 10 * MIN),
      created("t2", 2, T0, T0 + 10 * MIN),
      created("t3", 3, T0, T0 + 10 * MIN),
      created("t4", 4, T0, T0 + 10 * MIN),
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
        plannedFrom: T0 + 5 * MIN,
        plannedTo: T0 + 15 * MIN,
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
        plannedFrom: T0 + 10 * MIN,
        plannedTo: T0 + 20 * MIN,
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
      { taskId: "d1", title: "Oral care", oldFrom: T0 + 5 * MIN, oldTo: T0 + 15 * MIN, newFrom: T0 + 45 * MIN, newTo: T0 + 55 * MIN },
      { taskId: "d2", title: "Charting", oldFrom: T0 + 10 * MIN, oldTo: T0 + 20 * MIN, newFrom: T0 + 50 * MIN, newTo: T0 + 60 * MIN },
    ]);
    const confirm = confirmReschedule(deferredTasks[0], end.proposals[0], T0 + 56 * MIN, actorId);
    expect(confirm.type).toBe("TASK_RESCHEDULED");
    expect((confirm as Extract<DomainEvent, { type: "TASK_RESCHEDULED" }>).payload.plannedFrom).toBe(
      T0 + 45 * MIN,
    );
    expect((confirm as Extract<DomainEvent, { type: "TASK_RESCHEDULED" }>).payload.plannedTo).toBe(
      T0 + 55 * MIN,
    );

    expect(() =>
      confirmReschedule(deferredTasks[0], end.proposals[0], T0 + 56 * MIN, actorId, T0 + 50 * MIN, T0 + 40 * MIN),
    ).toThrow(DomainError);

    const fixed = proposeReschedule(deferredTasks, T0, T0 + 40 * MIN, {
      ...DEFAULT_CONFIG,
      rescheduleOffsetMode: "fixed",
      fixedOffsetMin: 15,
    });
    expect(fixed[0].newTo).toBe(T0 + 30 * MIN);
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
          plannedFrom: T0,
          plannedTo: T0 + 10 * MIN,
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
    const events = [created("d1", 3, T0, T0 + 10 * MIN), deferred("d1", T0)];
    expect(reduce(events).tasks.d1.status).toBe("deferred");
    expect(plans).toHaveLength(1);
    const afterConfirm = reduce([
      ...events,
      confirmReschedule(reduce(events).tasks.d1, plans[0], T0 + 40 * MIN, actorId),
    ]);
    expect(afterConfirm.tasks.d1.status).toBe("planned");
    expect(afterConfirm.tasks.d1.plannedFrom).toBe(T0 + 30 * MIN);
    expect(afterConfirm.tasks.d1.plannedTo).toBe(T0 + 40 * MIN);
  });
});

describe("durations and corrections", () => {
  it("sums multiple pause/resume segments", () => {
    const events = [
      created("x", 1, T0, T0 + 10 * MIN),
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
      created("x", 1, T0, T0 + 10 * MIN),
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
    const events = [created("x", 1, T0, T0 + 10 * MIN), start, end, correction];
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
      computeDurations([created("x", 1, T0, T0 + 10 * MIN), started("x", T0), end, c1, c2]).byTask.x.minutes,
    ).toBe(25);
  });

  it("splits direct, indirect, interruption and emergency minutes", () => {
    const events = [
      created("direct", 2, T0, T0 + 10 * MIN),
      started("direct", T0),
      completed("direct", T0 + 10 * MIN),
      created("indirect", 4, T0, T0 + 10 * MIN),
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
      plannedFrom: T0,
      plannedTo: T0 + 10 * MIN,
      expectedMin: 5,
      createdAt: T0,
      durationRecorded: false,
      pinned: false,
      needsAttention: false,
    };
    expect(isMissed(task, T0 + 29 * MIN, DEFAULT_CONFIG)).toBe(false);
    expect(isMissed(task, T0 + 39 * MIN, DEFAULT_CONFIG)).toBe(false);
    expect(isMissed(task, T0 + 41 * MIN, DEFAULT_CONFIG)).toBe(true);
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
      plannedFrom: T0,
      plannedTo: T0 + 10 * MIN,
      intervalMin: 60,
      expectedMin: 10,
      createdAt: T0,
      durationRecorded: true,
      pinned: false,
      needsAttention: false,
    };
    const next = nextRecurringTask(task, T0 + 15 * MIN, actorId);
    expect(next?.type).toBe("TASK_CREATED");
    expect((next as Extract<DomainEvent, { type: "TASK_CREATED" }>).payload.plannedFrom).toBe(
      T0 + 75 * MIN,
    );
    expect((next as Extract<DomainEvent, { type: "TASK_CREATED" }>).payload.plannedTo).toBe(
      T0 + 85 * MIN,
    );
  });
});

describe("shift duration limit", () => {
  it("treats a shift as expired after two normal 8-hour shifts", () => {
    expect(MAX_SHIFT_MS).toBe(16 * 60 * 60 * 1000);
    expect(isShiftExpired(T0, T0 + MAX_SHIFT_MS - 1)).toBe(false);
    expect(isShiftExpired(T0, T0 + MAX_SHIFT_MS)).toBe(true);
    expect(isShiftExpired(T0, T0 + MAX_SHIFT_MS + 33 * 60 * 60 * 1000)).toBe(true);
  });
});

describe("time logs and shift-scoped tasks", () => {
  it("records a past interval, marks the task done and counts its duration", () => {
    const events = [
      created("logged", 2, T0, T0 + 10 * MIN),
      timeLogged("logged", T0 + 2 * MIN, T0 + 8 * MIN, "Past interval"),
    ];
    const state = reduce(events);
    expect(state.tasks.logged.status).toBe("done");
    expect(state.tasks.logged.durationRecorded).toBe(true);
    expect(state.tasks.logged.timeLogs).toEqual([
      { startedAt: T0 + 2 * MIN, endedAt: T0 + 8 * MIN, note: "Past interval" },
    ]);
    const durations = computeDurations(events);
    expect(durations.byTask.logged.minutes).toBe(6);
    expect(durations.directCareMin).toBe(6);
    expect(durations.tickOnlyTaskIds).not.toContain("logged");
  });

  it("rejects a second time log when a duration is already recorded", () => {
    expect(() =>
      reduce([
        created("double", 2, T0, T0 + 10 * MIN),
        timeLogged("double", T0, T0 + 5 * MIN),
        timeLogged("double", T0, T0 + 10 * MIN),
      ]),
    ).toThrow(/already has a recorded duration/);
  });

  it("rejects a time log for missed or live-timer tasks", () => {
    expect(() =>
      reduce([
        created("missed", 2, T0, T0 + 10 * MIN),
        missed("missed", T0 + 20 * MIN),
        timeLogged("missed", T0 + 25 * MIN, T0 + 30 * MIN),
      ]),
    ).toThrow(/Missed tasks/);
    expect(() =>
      reduce([
        created("running", 2, T0, T0 + 10 * MIN),
        started("running", T0),
        timeLogged("running", T0, T0 + 10 * MIN),
      ]),
    ).toThrow(/live timer/);
  });

  it("keeps a shift-scoped task without a bed", () => {
    const state = reduce([
      ev("TASK_CREATED", T0, {
        bedId: undefined,
        taskId: "shift-task",
        payload: {
          title: "Shift report",
          category: "indirect_care",
          tier: 2,
          plannedFrom: T0,
          plannedTo: T0 + 15 * MIN,
          expectedMin: 15,
          scope: "shift",
        },
      }),
    ]);
    expect(state.tasks["shift-task"].scope).toBe("shift");
    expect(state.tasks["shift-task"].bedId).toBeUndefined();
    const snapshot = buildHandover([], { id: bedId, label: "Bed 1" });
    expect(snapshot.shiftTasks).toEqual([]);
  });
});

describe("handover", () => {
  it("builds a bed handover from events and marks emergency minutes", () => {
    const events = [
      created("done", 2, T0, T0 + 10 * MIN),
      started("done", T0),
      completed("done", T0 + 5 * MIN),
      created("pending", 3, T0, T0 + 10 * MIN, T0, { note: "Handover note" }),
      created("deferred", 3, T0, T0 + 10 * MIN),
      deferred("deferred", T0),
      created("missed", 2, T0, T0 + 10 * MIN),
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
    expect(h.pending[0]?.note).toBe("Handover note");
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
    const snapshot = buildHandover([created("x", 1, T0, T0 + 10 * MIN)], { id: bedId, label: "Bed 1" });
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
      created("t1", 1, T0 + 10 * MIN, T0 + 20 * MIN),
      started("t1", T0 + 5 * MIN),
      completed("t1", T0 + 15 * MIN),
      created("t2", 2, T0 + 20 * MIN, T0 + 30 * MIN),
      started("t2", T0 + 15 * MIN),
      completed("t2", T0 + 19 * MIN),
      created("t3", 3, T0 + 30 * MIN, T0 + 40 * MIN),
      ev("EMERGENCY_STARTED", T0 + 20 * MIN, { bedId }),
      deferred("t3", T0 + 25 * MIN),
      ev("EMERGENCY_ENDED", T0 + 50 * MIN, { bedId }),
      rescheduled("t3", T0 + 50 * MIN, T0 + 50 * MIN, T0 + 60 * MIN),
      started("t3", T0 + 50 * MIN),
      completed("t3", T0 + 55 * MIN),
      created("t4", 2, T0 + 5 * MIN, T0 + 15 * MIN),
      missed("t4", T0 + 60 * MIN, "shift_end"),
      created("t5", 4, T0 + 30 * MIN, T0 + 40 * MIN),
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
    expect(s.tier12OnTimeRate).toBeCloseTo(2 / 3);
    expect(s.missedCount).toBe(1);
    expect(s.deferredCount).toBe(0);
    expect(s.tierBreakdown[1]).toEqual({ total: 1, done: 1 });
    expect(s.tierBreakdown[2]).toEqual({ total: 2, done: 1 });
    expect(s.interruptionsByReason[0]).toMatchObject({ reason: "alarm_device", minutes: 5 });
    expect(s.totalMinutes).toBe(60);
  });
});

describe("legacy task payloads", () => {
  it("converts an old dueAt payload to a planned window", () => {
    const legacy = {
      id: "legacy-e1",
      shiftId,
      bedId,
      taskId: "legacy-task",
      actorId,
      type: "TASK_CREATED",
      clientTs: T0,
      payload: {
        title: "Legacy task",
        category: "direct_care",
        tier: 2,
        dueAt: T0 + 30 * MIN,
        expectedMin: 10,
      },
    } as unknown as DomainEvent;
    const state = reduce([legacy]);
    expect(state.tasks["legacy-task"].plannedFrom).toBe(T0 + 20 * MIN);
    expect(state.tasks["legacy-task"].plannedTo).toBe(T0 + 30 * MIN);
  });
});

describe("dynamic units", () => {
  it("carries the shift unit onto tasks, recurring tasks and the summary", () => {
    const events = [
      ev("SHIFT_STARTED", T0, {
        payload: { shiftType: "day", unitId: "unit-a", unitName: "Unit A" },
      }),
      created("unit-task", 2, T0 + 5 * MIN, T0 + 15 * MIN, T0, {
        unitId: "unit-a",
        intervalMin: 60,
      }),
      started("unit-task", T0 + 5 * MIN),
      completed("unit-task", T0 + 15 * MIN),
      ev("SHIFT_ENDED", T0 + 60 * MIN, { payload: {} }),
    ];
    const state = reduce(events);
    expect(state.shift?.unitId).toBe("unit-a");
    expect(state.shift?.unitName).toBe("Unit A");
    expect(state.tasks["unit-task"].unitId).toBe("unit-a");
    const recurring = nextRecurringTask(state.tasks["unit-task"], T0 + 15 * MIN, actorId);
    expect(recurring?.type).toBe("TASK_CREATED");
    expect((recurring?.payload as { unitId?: string }).unitId).toBe("unit-a");
    const summary = buildShiftSummary(events);
    expect(summary.unitId).toBe("unit-a");
    expect(summary.unitName).toBe("Unit A");
  });

  it("still reduces legacy shifts without a unit", () => {
    const state = reduce(shiftEvents([created("legacy", 3, T0 + 5 * MIN, T0 + 10 * MIN)]));
    expect(state.shift?.unitId).toBeUndefined();
    expect(state.tasks.legacy.unitId).toBeUndefined();
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
