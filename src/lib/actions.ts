"use client";

import {
  buildHandover,
  buildShiftSummary,
  confirmReschedule as confirmRescheduleEvent,
  endEmergency as endEmergencyDomain,
  isShiftExpired,
  isTaskEditable,
  MAX_SHIFT_HOURS,
  MAX_SHIFT_MS,
  newId,
  SHIFT_HANDOVER_ID,
  nextRecurringTask,
  reduce,
  startEmergency as startEmergencyDomain,
  type AppConfig,
  type DomainEvent,
  type EmergencyPlan,
  type RescheduleProposal,
  type ShiftSummary,
  type Task,
  type TaskCategory,
  type TaskEditPatch,
  type Tier,
} from "@/domain";
import { postHandover, postSummary } from "./api";
import {
  activeShift,
  db,
  getConfig,
  getSessionValue,
  setSessionValue,
  type ActiveInterruption,
  type AuthRecord,
  type ShiftRow,
  type SessionUser,
} from "./db";
import { DEMO_TEMPLATES, DEMO_TEMPLATES_VERSION } from "./demo-data";
import { rebuildTasks } from "./projection";
import { useApp } from "./store";
import { scheduleSync } from "./sync";

const MIN = 60_000;

function base(
  type: DomainEvent["type"],
  shift: { id: string; actorId: string },
  ts: number,
  payload: unknown,
  extra: { bedId?: string; taskId?: string } = {},
): DomainEvent {
  return {
    id: newId(),
    shiftId: shift.id,
    bedId: extra.bedId,
    taskId: extra.taskId,
    actorId: shift.actorId,
    type,
    clientTs: ts,
    payload,
  } as DomainEvent;
}

async function appendEvents(events: DomainEvent[]): Promise<void> {
  if (!events.length) return;
  const shiftId = events[0].shiftId;
  await db().transaction("rw", [db().events, db().tasks, db().outbox], async () => {
    await db().events.bulkPut(events);
    await rebuildTasks(shiftId);
    await db().outbox.bulkPut(
      events.map((event) => ({ id: event.id, kind: "event" as const, payload: event, createdAt: Date.now() })),
    );
  });
  scheduleSync();
}

export async function ensureTemplates(): Promise<void> {
  const version = await getSessionValue<number>("templatesVersion");
  if (version !== DEMO_TEMPLATES_VERSION) {
    await db().templates.clear();
    await db().templates.bulkPut(DEMO_TEMPLATES);
    await setSessionValue("templatesVersion", DEMO_TEMPLATES_VERSION);
    return;
  }
  if ((await db().templates.count()) === 0) {
    await db().templates.bulkPut(DEMO_TEMPLATES);
  }
}

export async function startShift(
  user: SessionUser,
  unit: { id: string; name: string },
  type: "day" | "night" | "custom",
  options: { backdateMin?: number } = {},
): Promise<ShiftRow> {
  if (!unit.id) throw new Error("Choose an assigned unit before starting a shift");
  await ensureTemplates();
  const existing = await activeShift(user.id);
  if (existing) {
    if (isShiftExpired(existing.startedAt)) {
      await endShift(
        existing.id,
        `Auto-ended: maximum shift length of ${MAX_SHIFT_HOURS} hours reached`,
        existing.startedAt + MAX_SHIFT_MS,
      );
    } else {
      return existing;
    }
  }
  const now = Date.now();
  const startedAt = now - (options.backdateMin ?? 0) * MIN;
  const shiftId = newId();
  const templates = await db().templates.toArray();
  const events: DomainEvent[] = [];
  const shift: ShiftRow = { id: shiftId, actorId: user.id, type, kind: "nurse", unitId: unit.id, unitName: unit.name, startedAt };

  events.push({
    id: newId(),
    shiftId,
    actorId: user.id,
    type: "SHIFT_STARTED",
    clientTs: startedAt,
    payload: { shiftType: type, kind: "nurse", unitId: unit.id, unitName: unit.name, bedLabels: [] },
  });

  for (const template of templates.filter((t) => t.role === "nurse" && t.scope === "shift" && t.active)) {
    events.push({
      id: newId(),
      shiftId,
      taskId: newId(),
      actorId: user.id,
      type: "TASK_CREATED",
      clientTs: startedAt,
      payload: {
        title: template.name,
        category: template.category,
        tier: template.tier,
        plannedFrom: startedAt + template.offsetMin * MIN,
        plannedTo: startedAt + template.offsetMin * MIN + template.expectedMin * MIN,
        expectedMin: template.expectedMin,
        intervalMin: template.intervalMin,
        unitId: unit.id,
        templateId: template.id,
        scope: "shift",
      },
    });
  }

  await db().transaction(
    "rw",
    [db().shifts, db().events, db().tasks, db().outbox],
    async () => {
      await db().shifts.put(shift);
      await db().events.bulkPut(events);
      await rebuildTasks(shiftId);
      await db().outbox.bulkPut(
        events.map((event) => ({ id: event.id, kind: "event" as const, payload: event, createdAt: Date.now() })),
      );
    },
  );
  await setSessionValue("activeInterruption", null);
  scheduleSync();
  return shift;
}

export async function getTask(taskId: string): Promise<Task | undefined> {
  return db().tasks.get(taskId);
}

export async function editTask(taskId: string, patch: TaskEditPatch): Promise<void> {
  const task = await getTask(taskId);
  if (!task) throw new Error("Task not found");
  if (!isTaskEditable(task.status)) throw new Error("Completed or missed tasks cannot be altered");
  const nextFrom = patch.plannedFrom ?? task.plannedFrom;
  const nextTo = patch.plannedTo ?? task.plannedTo;
  if (nextTo < nextFrom) throw new Error("Task end time cannot be before its start time");
  const shift = await db().shifts.get(task.shiftId);
  if (!shift) throw new Error("Shift not found");
  await appendEvents([
    base("TASK_EDITED", shift, Date.now(), patch, { bedId: task.bedId, taskId: task.id }),
  ]);
}

export async function removeTask(taskId: string, reason = ""): Promise<void> {
  const task = await getTask(taskId);
  if (!task) throw new Error("Task not found");
  if (!isTaskEditable(task.status)) throw new Error("Completed or missed tasks cannot be removed");
  const shift = await db().shifts.get(task.shiftId);
  if (!shift) throw new Error("Shift not found");
  await appendEvents([
    base("TASK_REMOVED", shift, Date.now(), { reason }, { bedId: task.bedId, taskId: task.id }),
  ]);
}

export async function startTask(taskId: string): Promise<void> {
  const task = await getTask(taskId);
  if (!task) throw new Error("Task not found");
  const shift = await db().shifts.get(task.shiftId);
  if (!shift) throw new Error("Shift not found");
  await appendEvents([
    base("TASK_STARTED", shift, Date.now(), {}, { bedId: task.bedId, taskId: task.id }),
  ]);
}

export async function pauseTask(taskId: string): Promise<void> {
  const task = await getTask(taskId);
  if (!task) throw new Error("Task not found");
  const shift = await db().shifts.get(task.shiftId);
  if (!shift) throw new Error("Shift not found");
  await appendEvents([
    base("TASK_PAUSED", shift, Date.now(), {}, { bedId: task.bedId, taskId: task.id }),
  ]);
}

export async function resumeTask(taskId: string): Promise<void> {
  const task = await getTask(taskId);
  if (!task) throw new Error("Task not found");
  const shift = await db().shifts.get(task.shiftId);
  if (!shift) throw new Error("Shift not found");
  await appendEvents([
    base("TASK_RESUMED", shift, Date.now(), {}, { bedId: task.bedId, taskId: task.id }),
  ]);
}

export async function completeTask(taskId: string, tickOnly = false): Promise<void> {
  const task = await getTask(taskId);
  if (!task) throw new Error("Task not found");
  const shift = await db().shifts.get(task.shiftId);
  if (!shift) throw new Error("Shift not found");
  const now = Date.now();
  const events = [
    base("TASK_COMPLETED", shift, now, { tickOnly }, { bedId: task.bedId, taskId: task.id }),
  ];
  const next = nextRecurringTask(task, now, shift.actorId);
  if (next) events.push(next);
  await appendEvents(events);
  if (tickOnly) useApp.getState().notify("Marked done. No duration was recorded.", "info");
}

async function shiftEvents(shiftId: string): Promise<DomainEvent[]> {
  return db().events.where("shiftId").equals(shiftId).toArray();
}

export async function activeEmergency(shiftId: string, bedId: string) {
  const state = reduce(await shiftEvents(shiftId));
  return state.emergencies.find((e) => e.bedId === bedId && !e.endedAt);
}

export async function startEmergency(bedId: string): Promise<EmergencyPlan> {
  const tasks = await db().tasks.where("bedId").equals(bedId).toArray();
  const shiftId = tasks[0]?.shiftId;
  if (!shiftId) throw new Error("No tasks on this bed");
  const shift = await db().shifts.get(shiftId);
  if (!shift) throw new Error("Shift not found");
  const plan = startEmergencyDomain(
    { shiftId, bedId, actorId: shift.actorId, tasks: tasks.filter((t) => t.shiftId === shiftId) },
    Date.now(),
  );
  await appendEvents(plan.events);
  await setSessionValue("activeInterruption", null);
  useApp.getState().notify("Emergency started. Tier 1–2 tasks are flagged, not deferred.", "warning");
  return plan;
}

export async function finishEmergency(
  bedId: string,
): Promise<{ durationMs: number; proposals: RescheduleProposal[] }> {
  const tasks = await db().tasks.where("bedId").equals(bedId).toArray();
  const shiftId = tasks[0]?.shiftId;
  if (!shiftId) throw new Error("No tasks on this bed");
  const shift = await db().shifts.get(shiftId);
  if (!shift) throw new Error("Shift not found");
  const state = reduce(await shiftEvents(shiftId));
  const emergency = state.emergencies.find((e) => e.bedId === bedId && !e.endedAt);
  if (!emergency) throw new Error("No active emergency on this bed");
  const config = await getConfig();
  const end = endEmergencyDomain(emergency, Object.values(state.tasks), Date.now(), shift.actorId, config);
  await appendEvents([end.event]);
  await setSessionValue(`reschedule:${bedId}`, {
    emergencyId: emergency.id,
    startedAt: emergency.startedAt,
    endedAt: end.event.clientTs,
    durationMs: end.durationMs,
    proposals: end.proposals,
  });
  return { durationMs: end.durationMs, proposals: end.proposals };
}

export type StoredReschedule = {
  emergencyId: string;
  startedAt: number;
  endedAt: number;
  durationMs: number;
  proposals: RescheduleProposal[];
};

export async function getReschedule(bedId: string): Promise<StoredReschedule | undefined> {
  return getSessionValue<StoredReschedule>(`reschedule:${bedId}`);
}

export async function confirmReschedule(
  bedId: string,
  taskId: string,
  newFrom: number,
  newTo: number,
): Promise<void> {
  const stored = await getReschedule(bedId);
  if (!stored) throw new Error("No reschedule proposals");
  const proposal = stored.proposals.find((p) => p.taskId === taskId);
  if (!proposal) throw new Error("Proposal not found");
  const task = await getTask(taskId);
  if (!task) throw new Error("Task not found");
  const shift = await db().shifts.get(task.shiftId);
  if (!shift) throw new Error("Shift not found");
  const event = confirmRescheduleEvent(task, proposal, Date.now(), shift.actorId, newFrom, newTo);
  await appendEvents([event]);
  const remaining = stored.proposals.filter((p) => p.taskId !== taskId);
  if (remaining.length) {
    await setSessionValue(`reschedule:${bedId}`, { ...stored, proposals: remaining });
  } else {
    await setSessionValue(`reschedule:${bedId}`, null);
  }
}

export async function startInterruption(
  reason: string,
  bedId?: string,
  taskId?: string,
): Promise<void> {
  const task = taskId ? await getTask(taskId) : undefined;
  const user = useApp.getState().user;
  const shiftId =
    task?.shiftId ??
    (bedId ? (await db().beds.get(bedId))?.shiftId : undefined) ??
    (user ? (await activeShift(user.id))?.id : undefined);
  if (!shiftId) throw new Error("No active shift");
  const shift = await db().shifts.get(shiftId);
  if (!shift) throw new Error("Shift not found");
  const now = Date.now();
  const wasRunning = task?.status === "in_progress";
  if (wasRunning && task) {
    await appendEvents([
      base("TASK_PAUSED", shift, now, { reason }, { bedId, taskId: task.id }),
    ]);
  }
  const pending: ActiveInterruption = {
    taskId: task?.id,
    bedId,
    shiftId,
    reason,
    startedAt: now,
    wasRunning,
  };
  await setSessionValue("activeInterruption", pending);
}

export async function endInterruption(): Promise<void> {
  const pending = await getSessionValue<ActiveInterruption>("activeInterruption");
  if (!pending) return;
  const shift = await db().shifts.get(pending.shiftId);
  if (!shift) throw new Error("Shift not found");
  const now = Date.now();
  const events: DomainEvent[] = [
    base(
      "INTERRUPTION_LOGGED",
      shift,
      now,
      { reason: pending.reason, startedAt: pending.startedAt, endedAt: now },
      { bedId: pending.bedId, taskId: pending.taskId },
    ),
  ];
  if (pending.wasRunning && pending.taskId) {
    const task = await getTask(pending.taskId);
    if (task?.status === "paused") {
      events.push(base("TASK_RESUMED", shift, now, {}, { bedId: pending.bedId, taskId: pending.taskId }));
    }
  }
  await appendEvents(events);
  await setSessionValue("activeInterruption", null);
}

export async function getActiveInterruption(): Promise<ActiveInterruption | undefined> {
  return getSessionValue<ActiveInterruption>("activeInterruption");
}

export async function pinTask(taskId: string, pinned: boolean): Promise<void> {
  await db().tasks.update(taskId, { pinned });
}

export async function correctEventTime(
  shiftId: string,
  targetEventId: string,
  newTs: number,
  note = "",
): Promise<void> {
  const shift = await db().shifts.get(shiftId);
  if (!shift) throw new Error("Shift not found");
  const target = await db().events.get(targetEventId);
  if (!target) throw new Error("Event not found");
  const event: DomainEvent = {
    id: newId(),
    shiftId,
    bedId: target.bedId,
    taskId: target.taskId,
    actorId: shift.actorId,
    type: "TIME_CORRECTED",
    clientTs: Date.now(),
    payload: { targetEventId, newTs, note },
  };
  await appendEvents([event]);
}

export async function addQuickTask(input: {
  shiftId: string;
  title: string;
  tier: Tier;
  category: TaskCategory;
  plannedFrom: number;
  plannedTo: number;
}): Promise<void> {
  const shift = await db().shifts.get(input.shiftId);
  if (!shift) throw new Error("Shift not found");
  if (input.category === "interruption") throw new Error("Unplanned tasks cannot be interruptions");
  await appendEvents([
    {
      id: newId(),
      shiftId: input.shiftId,
      taskId: newId(),
      actorId: shift.actorId,
      type: "TASK_CREATED",
      clientTs: Date.now(),
      payload: {
        title: input.title,
        category: input.category,
        tier: input.tier,
        plannedFrom: input.plannedFrom,
        plannedTo: input.plannedTo,
        expectedMin: 10,
        unitId: shift.unitId,
        scope: "shift",
      },
    },
  ]);
}

export async function addPlannedTask(input: {
  shiftId: string;
  scope: "bed" | "shift";
  bedId?: string;
  title: string;
  tier: Tier;
  category: Exclude<TaskCategory, "interruption">;
  plannedFrom: number;
  plannedTo: number;
  expectedMin?: number;
  note?: string;
}): Promise<string> {
  const shift = await db().shifts.get(input.shiftId);
  if (!shift) throw new Error("Shift not found");
  if (input.scope === "bed" && !input.bedId) throw new Error("Choose a bed for this task");
  if (input.plannedTo < input.plannedFrom) throw new Error("Task end time cannot be before its start time");
  if (input.plannedFrom < Date.now() - 5 * MIN) throw new Error("To Do tasks must be planned for the future");
  const bed = input.bedId ? await db().beds.get(input.bedId) : undefined;
  const taskId = newId();
  await appendEvents([
    {
      id: newId(),
      shiftId: input.shiftId,
      bedId: input.scope === "bed" ? input.bedId : undefined,
      taskId,
      actorId: shift.actorId,
      type: "TASK_CREATED",
      clientTs: Date.now(),
      payload: {
        title: input.title.trim(),
        category: input.category,
        tier: input.tier,
        plannedFrom: input.plannedFrom,
        plannedTo: input.plannedTo,
        expectedMin: input.expectedMin ?? Math.round((input.plannedTo - input.plannedFrom) / MIN),
        unitId: shift.unitId,
        bedLabel: bed?.alias,
        scope: input.scope,
        note: input.note,
      },
    },
  ]);
  return taskId;
}

export async function logTaskTime(
  taskId: string,
  startedAt: number,
  endedAt: number,
  note = "",
): Promise<void> {
  const task = await getTask(taskId);
  if (!task) throw new Error("Task not found");
  const shift = await db().shifts.get(task.shiftId);
  if (!shift) throw new Error("Shift not found");
  if (endedAt < startedAt) throw new Error("Time log end must be after its start");
  if (endedAt > Date.now() + 5 * MIN) throw new Error("Time log cannot end in the future");
  if (task.status === "missed") throw new Error("Missed tasks cannot receive a time log");
  if (task.durationRecorded) throw new Error("This task already has a recorded duration");
  if (task.status === "in_progress" || task.status === "paused") {
    throw new Error("Finish the live timer before logging a past interval");
  }
  const events: DomainEvent[] = [
    base(
      "TASK_TIME_LOGGED",
      shift,
      Date.now(),
      { startedAt, endedAt, note: note.trim() || undefined },
      { bedId: task.bedId, taskId: task.id },
    ),
  ];
  if (task.status !== "done") {
    const next = nextRecurringTask(task, endedAt, shift.actorId);
    if (next) events.push(next);
  }
  await appendEvents(events);
}

export async function finalizeHandover(
  shiftId: string,
  bedId: string,
  note: string,
): Promise<string> {
  const shift = await db().shifts.get(shiftId);
  if (!shift) throw new Error("Shift not found");
  const bed = bedId === SHIFT_HANDOVER_ID ? undefined : await db().beds.get(bedId);
  if (bedId !== SHIFT_HANDOVER_ID && !bed) throw new Error("Bed not found");
  const events = await shiftEvents(shiftId);
  const label = bedId === SHIFT_HANDOVER_ID ? "Shift handover" : (bed?.alias ?? "Bed");
  const snapshot = buildHandover(events, { id: bedId, label }, note, Date.now());
  const now = Date.now();
  const event = base(
    "HANDOVER_FINALIZED",
    shift,
    now,
    { snapshot: snapshot as unknown as Record<string, unknown>, note },
    { bedId },
  );
  await appendEvents([event]);
  await db().handovers.put({
    id: event.id,
    shiftId,
    bedId,
    snapshot,
    note,
    createdAt: now,
  });
  const auth = await getSessionValue<AuthRecord>("auth");
  if (auth) {
    void postHandover(auth.token, {
      id: event.id,
      shiftId,
      bedId,
      snapshot,
      note,
      createdAt: now,
    }).catch(() => undefined);
  }
  return event.id;
}

export async function endShift(shiftId: string, note = "", endedAt = Date.now()): Promise<ShiftSummary> {
  const shift = await db().shifts.get(shiftId);
  if (!shift) throw new Error("Shift not found");
  const tasks = await db().tasks.where("shiftId").equals(shiftId).toArray();
  const now = Math.min(Math.max(endedAt, shift.startedAt), Date.now());
  const events: DomainEvent[] = [];
  for (const task of tasks) {
    if (["planned", "in_progress", "paused"].includes(task.status)) {
      events.push(
        base("TASK_MISSED", shift, now, { reason: "shift_end" }, { bedId: task.bedId, taskId: task.id }),
      );
    }
  }
  events.push(base("SHIFT_ENDED", shift, now, { note }));
  await appendEvents(events);
  await setSessionValue("activeInterruption", null);
  const all = await shiftEvents(shiftId);
  const summary = buildShiftSummary(all, now);
  await db().shifts.update(shiftId, { endedAt: now, summary });
  const auth = await getSessionValue<AuthRecord>("auth");
  if (auth) {
    void postSummary(auth.token, shiftId).catch(() => undefined);
  }
  scheduleSync();
  return summary;
}

export async function getShiftSummary(shiftId: string): Promise<ShiftSummary | undefined> {
  const events = await shiftEvents(shiftId);
  if (!events.length) return undefined;
  return buildShiftSummary(events);
}

export async function getConfigForShift(): Promise<AppConfig> {
  return getConfig();
}

export async function getShiftEvents(shiftId: string): Promise<DomainEvent[]> {
  return shiftEvents(shiftId);
}
