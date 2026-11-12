"use client";

import {
  buildHandover,
  buildShiftSummary,
  confirmReschedule as confirmRescheduleEvent,
  endEmergency as endEmergencyDomain,
  newId,
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
  type BedRow,
  type ShiftRow,
  type SessionUser,
} from "./db";
import { DEMO_TEMPLATES } from "./demo-data";
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
  if ((await db().templates.count()) === 0) {
    await db().templates.bulkPut(DEMO_TEMPLATES);
  }
}

export async function startShift(
  user: SessionUser,
  type: "day" | "night" | "custom",
  beds: { id: string; label: string; alias: string; templateIds: string[] }[],
  options: { backdateMin?: number } = {},
): Promise<ShiftRow> {
  await ensureTemplates();
  const existing = await activeShift(user.id);
  if (existing) return existing;
  const now = Date.now();
  const startedAt = now - (options.backdateMin ?? 0) * MIN;
  const shiftId = newId();
  const templates = await db().templates.toArray();
  const templateMap = new Map(templates.map((t) => [t.id, t]));
  const events: DomainEvent[] = [];
  const shift: ShiftRow = { id: shiftId, actorId: user.id, type, startedAt };
  const bedRows: BedRow[] = [];

  events.push({
    id: newId(),
    shiftId,
    actorId: user.id,
    type: "SHIFT_STARTED",
    clientTs: startedAt,
    payload: { shiftType: type, bedLabels: beds.map((b) => b.alias) },
  });

  for (const bed of beds) {
    bedRows.push({ id: newId(), shiftId, label: bed.label, alias: bed.alias, templateIds: bed.templateIds });
    const bedId = bedRows[bedRows.length - 1].id;
    for (const templateId of bed.templateIds) {
      const template = templateMap.get(templateId);
      if (!template) continue;
      const taskId = newId();
      events.push({
        id: newId(),
        shiftId,
        bedId,
        taskId,
        actorId: user.id,
        type: "TASK_CREATED",
        clientTs: startedAt,
        payload: {
          title: template.name,
          category: template.category,
          tier: template.tier,
          dueAt: startedAt + template.offsetMin * MIN,
          expectedMin: template.expectedMin,
          intervalMin: template.intervalMin,
          templateId: template.id,
          bedLabel: bed.alias,
        },
      });
    }
  }

  await db().transaction(
    "rw",
    [db().shifts, db().beds, db().events, db().tasks, db().outbox],
    async () => {
      await db().shifts.put(shift);
      await db().beds.bulkPut(bedRows);
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
  newDue: number,
): Promise<void> {
  const stored = await getReschedule(bedId);
  if (!stored) throw new Error("No reschedule proposals");
  const proposal = stored.proposals.find((p) => p.taskId === taskId);
  if (!proposal) throw new Error("Proposal not found");
  const task = await getTask(taskId);
  if (!task) throw new Error("Task not found");
  const shift = await db().shifts.get(task.shiftId);
  if (!shift) throw new Error("Shift not found");
  const event = confirmRescheduleEvent(task, proposal, Date.now(), shift.actorId, newDue);
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
  bedId: string,
  taskId?: string,
): Promise<void> {
  const task = taskId ? await getTask(taskId) : undefined;
  const shiftId = task?.shiftId ?? (await db().beds.get(bedId))?.shiftId;
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
  bedId: string;
  title: string;
  tier: Tier;
  category: TaskCategory;
  dueAt: number;
}): Promise<void> {
  const shift = await db().shifts.get(input.shiftId);
  if (!shift) throw new Error("Shift not found");
  if (input.category === "interruption") throw new Error("Unplanned tasks cannot be interruptions");
  const bed = await db().beds.get(input.bedId);
  await appendEvents([
    {
      id: newId(),
      shiftId: input.shiftId,
      bedId: input.bedId,
      taskId: newId(),
      actorId: shift.actorId,
      type: "TASK_CREATED",
      clientTs: Date.now(),
      payload: {
        title: input.title,
        category: input.category,
        tier: input.tier,
        dueAt: input.dueAt,
        expectedMin: 10,
        bedLabel: bed?.alias,
      },
    },
  ]);
}

export async function finalizeHandover(
  shiftId: string,
  bedId: string,
  note: string,
): Promise<string> {
  const shift = await db().shifts.get(shiftId);
  if (!shift) throw new Error("Shift not found");
  const bed = await db().beds.get(bedId);
  if (!bed) throw new Error("Bed not found");
  const events = await shiftEvents(shiftId);
  const snapshot = buildHandover(events, { id: bedId, label: bed.alias }, note, Date.now());
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

export async function endShift(shiftId: string, note = ""): Promise<ShiftSummary> {
  const shift = await db().shifts.get(shiftId);
  if (!shift) throw new Error("Shift not found");
  const tasks = await db().tasks.where("shiftId").equals(shiftId).toArray();
  const now = Date.now();
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
