import {
  type AppConfig,
  type BedState,
  type DomainEvent,
  type DurationSummary,
  type EmergencyPlan,
  type EmergencyRecord,
  type HandoverSnapshot,
  type HandoverTask,
  type InterruptionReason,
  type InterruptionRecord,
  type ReducedState,
  type RescheduleProposal,
  type ShiftSummary,
  type Task,
  type TaskStatus,
  type Tier,
  DEFAULT_CONFIG,
  INTERRUPTION_LABELS,
  domainEventSchema,
} from "./types";

export class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DomainError";
  }
}

const MINUTE = 60_000;

export function newId(): string {
  return crypto.randomUUID();
}

export function parseEvent(input: unknown): DomainEvent {
  if (input && typeof input === "object") {
    const candidate = input as { type?: unknown; payload?: unknown };
    if (
      (candidate.type === "TASK_CREATED" || candidate.type === "TASK_RESCHEDULED") &&
      candidate.payload &&
      typeof candidate.payload === "object"
    ) {
      const payload = { ...(candidate.payload as Record<string, unknown>) };
      if (typeof payload.dueAt === "number") {
        const dueAt = payload.dueAt;
        const expectedMin = typeof payload.expectedMin === "number" ? payload.expectedMin : 10;
        payload.plannedTo ??= dueAt;
        payload.plannedFrom ??= Math.max(0, dueAt - expectedMin * 60_000);
        if (typeof payload.previousDueAt === "number") {
          payload.previousPlannedFrom ??= payload.previousDueAt;
          payload.previousPlannedTo ??= dueAt;
        }
        delete payload.dueAt;
        delete payload.previousDueAt;
        return domainEventSchema.parse({ ...candidate, payload });
      }
    }
  }
  return domainEventSchema.parse(input);
}

/* ------------------------------------------------------------------ */
/* State machine                                                       */
/* ------------------------------------------------------------------ */

const TRANSITIONS: Record<string, Partial<Record<DomainEvent["type"], TaskStatus>>> = {
  planned: {
    TASK_STARTED: "in_progress",
    TASK_DEFERRED: "deferred",
    TASK_COMPLETED: "done", // tick-only completion
    TASK_TIME_LOGGED: "done",
    TASK_MISSED: "missed",
  },
  in_progress: {
    TASK_PAUSED: "paused",
    TASK_COMPLETED: "done",
    TASK_MISSED: "missed",
  },
  paused: {
    TASK_RESUMED: "in_progress",
    TASK_MISSED: "missed",
  },
  deferred: {
    TASK_RESCHEDULED: "planned",
    TASK_TIME_LOGGED: "done",
  },
  done: {
    TASK_TIME_LOGGED: "done",
  },
  missed: {},
};

export function canTransition(status: TaskStatus, event: DomainEvent["type"]): boolean {
  return Boolean(TRANSITIONS[status]?.[event]);
}

/** A task can be altered only while it is still open. Done and missed tasks are frozen. */
export function isTaskEditable(status: TaskStatus): boolean {
  return status === "planned" || status === "in_progress" || status === "paused" || status === "deferred";
}

export function assertTransition(task: Task, event: DomainEvent): void {
  if (!canTransition(task.status, event.type)) {
    throw new DomainError(`Invalid transition ${task.status} -> ${event.type} for task ${task.id}`);
  }
  if (event.type === "TASK_DEFERRED") {
    if (task.tier === 1 || task.tier === 2) {
      throw new DomainError("Tier 1 and tier 2 tasks can never be deferred");
    }
    if (task.status !== "planned") {
      throw new DomainError("Only planned tier 3-4 tasks can be deferred");
    }
  }
  if (event.type === "TASK_COMPLETED" && task.status === "planned") {
    if (!event.payload.tickOnly) {
      throw new DomainError("A task that was never started must be completed as tick-only");
    }
  }
  if (event.type === "TASK_RESCHEDULED" && task.status !== "deferred") {
    throw new DomainError("Only deferred tasks can be rescheduled");
  }
}

/* ------------------------------------------------------------------ */
/* Reducer                                                             */
/* ------------------------------------------------------------------ */

type CorrectionMap = Record<string, number>;

const EVENT_PRIORITY: Record<DomainEvent["type"], number> = {
  SHIFT_STARTED: 0,
  TASK_CREATED: 1,
  TASK_RESCHEDULED: 2,
  TASK_EDITED: 2,
  TASK_TIME_LOGGED: 2,
  EMERGENCY_STARTED: 2,
  TASK_STARTED: 3,
  TASK_RESUMED: 3,
  TASK_PAUSED: 4,
  TASK_DEFERRED: 4,
  TASK_COMPLETED: 5,
  TASK_MISSED: 5,
  INTERRUPTION_LOGGED: 6,
  EMERGENCY_ENDED: 7,
  HANDOVER_FINALIZED: 8,
  SHIFT_ENDED: 9,
  TIME_CORRECTED: 10,
};

function orderEvents(a: DomainEvent, b: DomainEvent): number {
  return a.clientTs - b.clientTs || EVENT_PRIORITY[a.type] - EVENT_PRIORITY[b.type] || a.id.localeCompare(b.id);
}

function buildCorrections(events: DomainEvent[]): CorrectionMap {
  const corrections: CorrectionMap = {};
  const correctionEvents = events
    .filter((e): e is Extract<DomainEvent, { type: "TIME_CORRECTED" }> => e.type === "TIME_CORRECTED")
    .sort((a, b) => a.clientTs - b.clientTs || a.id.localeCompare(b.id));
  for (const event of correctionEvents) {
    corrections[event.payload.targetEventId] = event.payload.newTs;
  }
  return corrections;
}

function effectiveTs(event: DomainEvent, corrections: CorrectionMap): number {
  return corrections[event.id] ?? event.clientTs;
}

function activeEmergencyFor(state: ReducedState, bedId: string | undefined): EmergencyRecord | undefined {
  if (!bedId) return undefined;
  return state.emergencies.find((e) => e.bedId === bedId && !e.endedAt);
}

function markAttention(state: ReducedState): void {
  for (const task of Object.values(state.tasks)) {
    const emergency = activeEmergencyFor(state, task.bedId);
    task.needsAttention =
      Boolean(emergency) && task.tier <= 2 && !["done", "missed", "deferred"].includes(task.status);
  }
}

export function reduce(input: DomainEvent[]): ReducedState {
  const parsed = input.map(parseEvent);
  const unique = new Map<string, DomainEvent>();
  for (const event of parsed) {
    if (!unique.has(event.id)) unique.set(event.id, event);
  }
  const events = [...unique.values()].sort(orderEvents);
  const corrections = buildCorrections(events);
  const state: ReducedState = {
    tasks: {},
    interruptions: [],
    emergencies: [],
    handoverSnapshots: {},
  };

  for (const event of events) {
    const ts = effectiveTs(event, corrections);
    switch (event.type) {
      case "SHIFT_STARTED":
        state.shift = {
          id: event.shiftId,
          actorId: event.actorId,
          type: event.payload.shiftType,
          kind: event.payload.kind ?? "nurse",
          unitId: event.payload.unitId,
          unitName: event.payload.unitName,
          startedAt: ts,
          note: event.payload.note,
        };
        break;
      case "SHIFT_ENDED":
        if (!state.shift) throw new DomainError("Cannot end a shift that was never started");
        state.shift.endedAt = ts;
        state.shift.note = event.payload.note ?? state.shift.note;
        break;
      case "TASK_CREATED": {
        if (!event.taskId) throw new DomainError("Task events need a task id");
        if (state.tasks[event.taskId]) throw new DomainError(`Duplicate task ${event.taskId}`);
        const scope = event.payload.scope ?? (event.bedId ? "bed" : "shift");
        if (scope === "bed" && !event.bedId) throw new DomainError("Bed tasks need a bed id");
        state.tasks[event.taskId] = {
          id: event.taskId,
          shiftId: event.shiftId,
          bedId: event.bedId,
          scope,
          unitId: event.payload.unitId,
          title: event.payload.title,
          category: event.payload.category,
          tier: event.payload.tier,
          status: "planned",
          plannedFrom: event.payload.plannedFrom,
          plannedTo: event.payload.plannedTo,
          expectedMin: event.payload.expectedMin,
          intervalMin: event.payload.intervalMin,
          templateId: event.payload.templateId,
          note: event.payload.note,
          createdAt: ts,
          durationRecorded: false,
          timeLogs: [],
          pinned: false,
          needsAttention: false,
        };
        break;
      }
      case "TASK_STARTED":
      case "TASK_PAUSED":
      case "TASK_RESUMED":
      case "TASK_COMPLETED":
      case "TASK_DEFERRED":
      case "TASK_RESCHEDULED":
      case "TASK_MISSED": {
        const task = event.taskId ? state.tasks[event.taskId] : undefined;
        if (!task) throw new DomainError(`Unknown task ${event.taskId ?? "(none)"}`);
        assertTransition(task, event);
        switch (event.type) {
          case "TASK_STARTED":
            task.status = "in_progress";
            task.startedAt ??= ts;
            task.pausedAt = undefined;
            break;
          case "TASK_PAUSED":
            task.status = "paused";
            task.pausedAt = ts;
            break;
          case "TASK_RESUMED":
            task.status = "in_progress";
            task.pausedAt = undefined;
            break;
          case "TASK_COMPLETED":
            task.status = "done";
            task.completedAt = ts;
            task.durationRecorded = Boolean(task.startedAt) && !event.payload.tickOnly;
            break;
          case "TASK_DEFERRED":
            task.status = "deferred";
            break;
          case "TASK_RESCHEDULED":
            task.status = "planned";
            task.plannedFrom = event.payload.plannedFrom;
            task.plannedTo = event.payload.plannedTo;
            task.rescheduledAt = ts;
            break;
          case "TASK_MISSED":
            task.status = "missed";
            task.missedAt = ts;
            break;
        }
        break;
      }
      case "TASK_TIME_LOGGED": {
        const task = event.taskId ? state.tasks[event.taskId] : undefined;
        if (!task) throw new DomainError(`Unknown task ${event.taskId ?? "(none)"}`);
        if (task.status === "missed") throw new DomainError("Missed tasks cannot receive a time log");
        if (task.durationRecorded) throw new DomainError("This task already has a recorded duration");
        if (task.status === "in_progress" || task.status === "paused") {
          throw new DomainError("Finish the live timer before logging a past interval");
        }
        if (event.payload.endedAt < event.payload.startedAt) {
          throw new DomainError("Time log end precedes start");
        }
        task.status = "done";
        task.startedAt ??= event.payload.startedAt;
        task.completedAt = event.payload.endedAt;
        task.durationRecorded = true;
        (task.timeLogs ??= []).push({
          startedAt: event.payload.startedAt,
          endedAt: event.payload.endedAt,
          note: event.payload.note,
        });
        break;
      }
      case "TASK_EDITED": {
        const task = event.taskId ? state.tasks[event.taskId] : undefined;
        if (!task) throw new DomainError(`Unknown task ${event.taskId ?? "(none)"}`);
        if (!isTaskEditable(task.status)) {
          throw new DomainError("Completed or missed tasks cannot be altered");
        }
        const nextFrom = event.payload.plannedFrom ?? task.plannedFrom;
        const nextTo = event.payload.plannedTo ?? task.plannedTo;
        if (nextTo < nextFrom) {
          throw new DomainError("Task end time cannot be before its start time");
        }
        if (event.payload.title !== undefined) task.title = event.payload.title;
        if (event.payload.category !== undefined) task.category = event.payload.category;
        if (event.payload.tier !== undefined) task.tier = event.payload.tier;
        if (event.payload.expectedMin !== undefined) task.expectedMin = event.payload.expectedMin;
        if (event.payload.plannedFrom !== undefined) task.plannedFrom = event.payload.plannedFrom;
        if (event.payload.plannedTo !== undefined) task.plannedTo = event.payload.plannedTo;
        if (event.payload.note !== undefined) task.note = event.payload.note;
        break;
      }
      case "TIME_CORRECTED":
        // Applied in the correction pass; originals stay untouched in the event log.
        break;
      case "INTERRUPTION_LOGGED": {
        if (event.payload.endedAt < event.payload.startedAt) {
          throw new DomainError("Interruption end precedes start");
        }
        const task = event.taskId ? state.tasks[event.taskId] : undefined;
        state.interruptions.push({
          id: event.id,
          shiftId: event.shiftId,
          bedId: event.bedId ?? task?.bedId,
          taskId: event.taskId,
          reason: event.payload.reason,
          startedAt: event.payload.startedAt,
          endedAt: event.payload.endedAt,
          note: event.payload.note,
        });
        break;
      }
      case "EMERGENCY_STARTED": {
        if (!event.bedId) throw new DomainError("Emergency needs a bed");
        if (activeEmergencyFor(state, event.bedId)) {
          throw new DomainError(`Emergency already active on ${event.bedId}`);
        }
        state.emergencies.push({
          id: event.id,
          shiftId: event.shiftId,
          bedId: event.bedId,
          startedAt: ts,
          note: event.payload.note,
        });
        break;
      }
      case "EMERGENCY_ENDED": {
        if (!event.bedId) throw new DomainError("Emergency needs a bed");
        const emergency = activeEmergencyFor(state, event.bedId);
        if (!emergency) throw new DomainError(`No active emergency on ${event.bedId}`);
        emergency.endedAt = ts;
        break;
      }
      case "HANDOVER_FINALIZED": {
        if (!event.bedId) throw new DomainError("Handover needs a bed");
        if (state.handoverSnapshots[event.bedId]) {
          throw new DomainError("A finalized handover is immutable; create a new shift to revise it");
        }
        state.handoverSnapshots[event.bedId] = event.payload.snapshot as unknown as HandoverSnapshot;
        break;
      }
    }
    markAttention(state);
  }
  return state;
}

/* ------------------------------------------------------------------ */
/* Sorting and time rules                                              */
/* ------------------------------------------------------------------ */

export function isOverdue(task: Task, now: number): boolean {
  return (
    !["done", "deferred", "missed"].includes(task.status) && task.plannedTo < now
  );
}

export function sortTasks(tasks: Task[], now: number): Task[] {
  return [...tasks].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if (a.tier !== b.tier) return a.tier - b.tier;
    const aOverdue = isOverdue(a, now);
    const bOverdue = isOverdue(b, now);
    if (aOverdue !== bOverdue) return aOverdue ? -1 : 1;
    if (aOverdue && bOverdue && a.plannedTo !== b.plannedTo) return a.plannedTo - b.plannedTo;
    if (a.plannedFrom !== b.plannedFrom) return a.plannedFrom - b.plannedFrom;
    if (a.plannedTo !== b.plannedTo) return a.plannedTo - b.plannedTo;
    return a.id.localeCompare(b.id);
  });
}

export function isMissed(
  task: Task,
  now: number,
  config: AppConfig = DEFAULT_CONFIG,
  shiftEndedAt?: number,
): boolean {
  if (["done", "deferred", "missed"].includes(task.status)) return false;
  if (shiftEndedAt) return true;
  if (task.status !== "planned") return false;
  return now > task.plannedTo + config.missedTimeoutMin * MINUTE;
}

export function nextRecurringTask(
  task: Task,
  completedAt: number,
  actorId: string,
): DomainEvent | null {
  if (!task.intervalMin || task.intervalMin <= 0) return null;
  const taskId = newId();
  return {
    id: newId(),
    shiftId: task.shiftId,
    bedId: task.bedId,
    taskId,
    actorId,
    type: "TASK_CREATED",
    clientTs: completedAt,
    payload: {
      title: task.title,
      category: task.category,
      tier: task.tier,
      plannedFrom: completedAt + task.intervalMin * MINUTE,
      plannedTo:
        completedAt +
        task.intervalMin * MINUTE +
        task.expectedMin * MINUTE,
      expectedMin: task.expectedMin,
      intervalMin: task.intervalMin,
      unitId: task.unitId,
      templateId: task.templateId,
      scope: task.scope,
      note: task.note,
    },
  };
}

/* ------------------------------------------------------------------ */
/* Emergency and rescheduling                                          */
/* ------------------------------------------------------------------ */

export function startEmergency(
  bed: BedState,
  now: number,
  emergencyId = newId(),
): EmergencyPlan {
  const events: DomainEvent[] = [];
  const pausedTaskIds: string[] = [];
  const deferredTaskIds: string[] = [];
  const flaggedTaskIds: string[] = [];
  const emergencyEventId = `${emergencyId}:start`;

  events.push({
    id: emergencyEventId,
    shiftId: bed.shiftId,
    bedId: bed.bedId,
    actorId: bed.actorId,
    type: "EMERGENCY_STARTED",
    clientTs: now,
    payload: {},
  });

  for (const task of bed.tasks) {
    if (task.status === "done" || task.status === "missed" || task.status === "deferred") continue;
    if (task.tier <= 2) {
      // Tier 1-2 work is never deferred. It is surfaced to the nurse instead.
      if (task.status === "in_progress" || task.status === "paused" || task.status === "planned") {
        flaggedTaskIds.push(task.id);
      }
    }
    if (task.status === "in_progress") {
      events.push({
        id: `${emergencyId}:pause:${task.id}`,
        shiftId: bed.shiftId,
        bedId: bed.bedId,
        taskId: task.id,
        actorId: bed.actorId,
        type: "TASK_PAUSED",
        clientTs: now,
        payload: { reason: "emergency" },
      });
      pausedTaskIds.push(task.id);
    } else if (task.status === "planned" && task.tier >= 3) {
      events.push({
        id: `${emergencyId}:defer:${task.id}`,
        shiftId: bed.shiftId,
        bedId: bed.bedId,
        taskId: task.id,
        actorId: bed.actorId,
        type: "TASK_DEFERRED",
        clientTs: now,
        payload: { reason: "emergency", emergencyId },
      });
      deferredTaskIds.push(task.id);
    }
  }

  return { emergencyId, events, pausedTaskIds, deferredTaskIds, flaggedTaskIds };
}

export function proposeReschedule(
  deferred: Task[],
  startTs: number,
  endTs: number,
  config: AppConfig = DEFAULT_CONFIG,
): RescheduleProposal[] {
  const duration = Math.max(0, endTs - startTs);
  const offset = config.rescheduleOffsetMode === "fixed" ? config.fixedOffsetMin * MINUTE : duration;
  return deferred
    .filter((task) => task.status === "deferred")
    .map((task) => ({
      taskId: task.id,
      title: task.title,
      oldFrom: task.plannedFrom,
      oldTo: task.plannedTo,
      newFrom: task.plannedFrom + offset,
      newTo: task.plannedTo + offset,
    }));
}

export function endEmergency(
  emergency: EmergencyRecord,
  tasks: Task[],
  now: number,
  actorId: string,
  config: AppConfig = DEFAULT_CONFIG,
): {
  event: DomainEvent;
  durationMs: number;
  proposals: RescheduleProposal[];
} {
  if (emergency.endedAt) throw new DomainError("Emergency already ended");
  const event: DomainEvent = {
    id: `${emergency.id}:end`,
    shiftId: emergency.shiftId,
    bedId: emergency.bedId,
    actorId,
    type: "EMERGENCY_ENDED",
    clientTs: now,
    payload: {},
  };
  const deferred = tasks.filter((t) => t.bedId === emergency.bedId && t.status === "deferred");
  return {
    event,
    durationMs: Math.max(0, now - emergency.startedAt),
    proposals: proposeReschedule(deferred, emergency.startedAt, now, config),
  };
}

export function confirmReschedule(
  task: Task,
  proposal: RescheduleProposal,
  confirmedAt: number,
  actorId: string,
  editedFrom?: number,
  editedTo?: number,
): DomainEvent {
  if (task.status !== "deferred") {
    throw new DomainError("Only deferred tasks can be confirmed");
  }
  const plannedFrom = editedFrom ?? proposal.newFrom;
  const plannedTo = editedTo ?? proposal.newTo;
  if (!Number.isFinite(plannedFrom) || !Number.isFinite(plannedTo)) {
    throw new DomainError("Planned window needs valid start and end times");
  }
  if (plannedTo < plannedFrom) {
    throw new DomainError("Planned end must be at or after planned start");
  }
  return {
    id: newId(),
    shiftId: task.shiftId,
    bedId: task.bedId,
    taskId: task.id,
    actorId,
    type: "TASK_RESCHEDULED",
    clientTs: confirmedAt,
    payload: {
      plannedFrom,
      plannedTo,
      previousPlannedFrom: proposal.oldFrom,
      previousPlannedTo: proposal.oldTo,
      reason: "emergency",
    },
  };
}

/* ------------------------------------------------------------------ */
/* Durations                                                           */
/* ------------------------------------------------------------------ */

export function computeDurations(events: DomainEvent[], now = Date.now()): DurationSummary {
  const parsed = events.map(parseEvent);
  const corrections = buildCorrections(parsed);
  const tasks = new Map<string, Task>();
  for (const event of parsed) {
    if (event.type !== "TASK_CREATED" || !event.taskId) continue;
    tasks.set(event.taskId, {
      id: event.taskId,
      shiftId: event.shiftId,
      bedId: event.bedId,
      scope: event.payload.scope ?? (event.bedId ? "bed" : "shift"),
      title: event.payload.title,
      category: event.payload.category,
      tier: event.payload.tier,
      status: "planned",
      plannedFrom: event.payload.plannedFrom,
      plannedTo: event.payload.plannedTo,
      expectedMin: event.payload.expectedMin,
      intervalMin: event.payload.intervalMin,
      templateId: event.payload.templateId,
      createdAt: effectiveTs(event, corrections),
      durationRecorded: false,
      timeLogs: [],
      pinned: false,
      needsAttention: false,
    });
  }

  const byTask: DurationSummary["byTask"] = {};
  const tickOnlyTaskIds: string[] = [];
  let directCareMin = 0;
  let indirectCareMin = 0;

  for (const [taskId, task] of tasks) {
    const taskEvents = parsed
      .filter((e) => e.taskId === taskId)
      .map((e) => ({ event: e, ts: effectiveTs(e, corrections) }))
      .sort((a, b) => a.ts - b.ts || EVENT_PRIORITY[a.event.type] - EVENT_PRIORITY[b.event.type] || a.event.id.localeCompare(b.event.id));
    let open: number | undefined;
    let minutes = 0;
    for (const { event, ts } of taskEvents) {
      if (event.type === "TASK_STARTED" || event.type === "TASK_RESUMED") {
        if (open === undefined) open = ts;
      } else if (event.type === "TASK_PAUSED") {
        if (open !== undefined) {
          minutes += Math.max(0, ts - open) / MINUTE;
          open = undefined;
        }
      } else if (event.type === "TASK_COMPLETED" || event.type === "TASK_MISSED") {
        if (open !== undefined) {
          minutes += Math.max(0, ts - open) / MINUTE;
          open = undefined;
        }
      } else if (event.type === "TASK_TIME_LOGGED") {
        minutes += Math.max(0, event.payload.endedAt - event.payload.startedAt) / MINUTE;
      }
    }
    const hasStart = taskEvents.some(({ event }) => event.type === "TASK_STARTED" || event.type === "TASK_RESUMED");
    if (!hasStart && taskEvents.some(({ event }) => event.type === "TASK_COMPLETED")) {
      tickOnlyTaskIds.push(taskId);
    }
    byTask[taskId] = { minutes: Math.round(minutes * 10) / 10, category: task.category };
    if (task.category === "direct_care") directCareMin += minutes;
    else indirectCareMin += minutes;
  }

  let interruptionMin = 0;
  const interruptionsByReason: DurationSummary["interruptionsByReason"] = {};
  for (const event of parsed) {
    if (event.type !== "INTERRUPTION_LOGGED") continue;
    const minutes = Math.max(0, event.payload.endedAt - event.payload.startedAt) / MINUTE;
    interruptionMin += minutes;
    const prev = interruptionsByReason[event.payload.reason] ?? { count: 0, minutes: 0 };
    interruptionsByReason[event.payload.reason] = {
      count: prev.count + 1,
      minutes: prev.minutes + minutes,
    };
  }

  let emergencyMin = 0;
  const activeByBed: Record<string, number> = {};
  for (const event of parsed.sort((a, b) => effectiveTs(a, corrections) - effectiveTs(b, corrections))) {
    if (!event.bedId) continue;
    const ts = effectiveTs(event, corrections);
    if (event.type === "EMERGENCY_STARTED") activeByBed[event.bedId] = ts;
    if (event.type === "EMERGENCY_ENDED" && activeByBed[event.bedId] !== undefined) {
      emergencyMin += Math.max(0, ts - activeByBed[event.bedId]) / MINUTE;
      delete activeByBed[event.bedId];
    }
  }
  for (const start of Object.values(activeByBed)) {
    emergencyMin += Math.max(0, now - start) / MINUTE;
  }

  return {
    byTask,
    directCareMin: Math.round(directCareMin * 10) / 10,
    indirectCareMin: Math.round(indirectCareMin * 10) / 10,
    interruptionMin: Math.round(interruptionMin * 10) / 10,
    emergencyMin: Math.round(emergencyMin * 10) / 10,
    interruptionsByReason,
    tickOnlyTaskIds,
  };
}

/* ------------------------------------------------------------------ */
/* Handover and summary                                                */
/* ------------------------------------------------------------------ */

function toHandoverTask(task: Task): HandoverTask {
  return {
    id: task.id,
    title: task.title,
    tier: task.tier,
    status: task.status,
    plannedFrom: task.plannedFrom,
    plannedTo: task.plannedTo,
    completedAt: task.completedAt,
    category: task.category,
    note: task.note,
  };
}

export function buildHandover(
  events: DomainEvent[],
  bed: { id: string; label: string },
  note = "",
  now = Date.now(),
): HandoverSnapshot {
  const state = reduce(events);
  const durations = computeDurations(events, now);
  const tasks = sortTasks(
    Object.values(state.tasks).filter((t) => t.bedId === bed.id),
    now,
  );
  const shiftTasks = sortTasks(
    Object.values(state.tasks).filter((t) => t.scope === "shift"),
    now,
  );
  const interruptions = state.interruptions.filter((i) => i.bedId === bed.id);
  const grouped = new Map<InterruptionReason, { count: number; minutes: number }>();
  for (const item of interruptions) {
    const prev = grouped.get(item.reason) ?? { count: 0, minutes: 0 };
    grouped.set(item.reason, {
      count: prev.count + 1,
      minutes: prev.minutes + Math.max(0, item.endedAt - item.startedAt) / MINUTE,
    });
  }
  const emergencyMin = state.emergencies
    .filter((e) => e.bedId === bed.id)
    .reduce((sum, e) => sum + Math.max(0, (e.endedAt ?? now) - e.startedAt) / MINUTE, 0);
  const range = (statuses: TaskStatus[]) =>
    tasks.filter((t) => statuses.includes(t.status)).map(toHandoverTask);

  return {
    bedId: bed.id,
    bedLabel: bed.label,
    shiftId: tasks[0]?.shiftId ?? state.shift?.id ?? "",
    done: range(["done"]),
    pending: range(["planned", "in_progress", "paused"]),
    deferred: range(["deferred"]),
    missed: range(["missed"]),
    shiftTasks: shiftTasks.map(toHandoverTask),
    interruptions: [...grouped.entries()].map(([reason, v]) => ({
      reason,
      label: INTERRUPTION_LABELS[reason],
      count: v.count,
      minutes: Math.round(v.minutes * 10) / 10,
    })),
    note,
    generatedAt: now,
    emergencyMinutes: Math.round(emergencyMin * 10) / 10,
  };
}

export function buildShiftSummary(events: DomainEvent[], now = Date.now()): ShiftSummary {
  const state = reduce(events);
  const durations = computeDurations(events, now);
  const tasks = Object.values(state.tasks);
  const endedAt = state.shift?.endedAt;
  const startedAt = state.shift?.startedAt ?? 0;
  const tasksDone = tasks.filter((t) => t.status === "done").length;
  const tier12Considered = tasks.filter(
    (t) => t.tier <= 2 && (t.status === "done" || t.status === "missed"),
  );
  const tier12OnTime = tier12Considered.filter(
    (t) => t.status === "done" && t.completedAt !== undefined && t.completedAt <= t.plannedTo,
  ).length;
  const tierBreakdown = {
    1: { total: 0, done: 0 },
    2: { total: 0, done: 0 },
    3: { total: 0, done: 0 },
    4: { total: 0, done: 0 },
  } as Record<Tier, { total: number; done: number }>;
  for (const task of tasks) {
    tierBreakdown[task.tier].total += 1;
    if (task.status === "done") tierBreakdown[task.tier].done += 1;
  }

  return {
    shiftId: state.shift?.id ?? "",
    unitId: state.shift?.unitId,
    unitName: state.shift?.unitName,
    startedAt,
    endedAt,
    totalMinutes: Math.max(0, ((endedAt ?? now) - startedAt) / MINUTE),
    directCareMin: durations.directCareMin,
    indirectCareMin: durations.indirectCareMin,
    interruptionMin: durations.interruptionMin,
    emergencyMin: durations.emergencyMin,
    tasksTotal: tasks.length,
    tasksDone,
    completionRate: tasks.length ? tasksDone / tasks.length : 0,
    tier12OnTimeRate: tier12Considered.length ? tier12OnTime / tier12Considered.length : 0,
    deferredCount: tasks.filter((t) => t.status === "deferred").length,
    missedCount: tasks.filter((t) => t.status === "missed").length,
    interruptionsByReason: Object.entries(durations.interruptionsByReason)
      .map(([reason, v]) => ({
        reason: reason as InterruptionReason,
        label: INTERRUPTION_LABELS[reason as InterruptionReason] ?? reason,
        count: v.count,
        minutes: Math.round(v.minutes * 10) / 10,
      }))
      .sort((a, b) => b.minutes - a.minutes),
    tierBreakdown,
  };
}
