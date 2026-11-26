import { z } from "zod";

export type Role = "nurse" | "head_nurse";
export type Tier = 1 | 2 | 3 | 4;
export type TaskCategory = "direct_care" | "indirect_care" | "interruption";
export type TaskStatus = "planned" | "in_progress" | "paused" | "done" | "deferred" | "missed" | "removed";
export type TaskScope = "bed" | "shift";
export type ShiftKind = "nurse" | "head_nurse";

export type UnitStatus = "active" | "inactive";

/** Dynamic unit configured by a head nurse. Covers nurses and their shifts/tasks. */
export type Unit = {
  id: string;
  name: string;
  description: string;
  status: UnitStatus;
  createdAt: number;
  updatedAt: number;
};

/** Offline cache row for a nurse's assigned active units. */
export type UnitRow = {
  id: string;
  name: string;
  description: string;
  status: UnitStatus;
  updatedAt: number;
};

export const INTERRUPTION_REASONS = [
  "physician_request",
  "missing_equipment",
  "family_visitor",
  "other_staff",
  "alarm_device",
  "emergency",
  "other",
] as const;
export type InterruptionReason = (typeof INTERRUPTION_REASONS)[number];

export const INTERRUPTION_LABELS: Record<InterruptionReason, string> = {
  physician_request: "Physician request",
  missing_equipment: "Missing equipment",
  family_visitor: "Family / visitor",
  other_staff: "Other staff",
  alarm_device: "Alarm / device",
  emergency: "Emergency",
  other: "Other",
};

export const TIER_LABELS: Record<Tier, string> = {
  1: "Life support",
  2: "Time-critical",
  3: "Routine care",
  4: "Administrative",
};

export const CATEGORY_LABELS: Record<TaskCategory, string> = {
  direct_care: "Direct care",
  indirect_care: "Indirect care",
  interruption: "Interruption",
};

export const SHIFT_TYPES = ["day", "night", "custom"] as const;
export type ShiftType = (typeof SHIFT_TYPES)[number];

/** A shift cannot stay open indefinitely. Two normal 8-hour shifts = 16 hours. */
export const MAX_SHIFT_HOURS = 16;
export const MAX_SHIFT_MS = MAX_SHIFT_HOURS * 60 * 60 * 1000;

export function shiftLimitEnd(startedAt: number): number {
  return startedAt + MAX_SHIFT_MS;
}

export function isShiftExpired(startedAt: number, now = Date.now()): boolean {
  return now >= shiftLimitEnd(startedAt);
}

export const EVENT_TYPES = [
  "SHIFT_STARTED",
  "SHIFT_ENDED",
  "TASK_CREATED",
  "TASK_STARTED",
  "TASK_PAUSED",
  "TASK_RESUMED",
  "TASK_COMPLETED",
  "TASK_DEFERRED",
  "TASK_RESCHEDULED",
  "TASK_EDITED",
  "TASK_TIME_LOGGED",
  "TASK_MISSED",
  "TASK_REMOVED",
  "TIME_CORRECTED",
  "INTERRUPTION_LOGGED",
  "EMERGENCY_STARTED",
  "EMERGENCY_ENDED",
  "HANDOVER_FINALIZED",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

const iso = z.number().int().nonnegative();

export const shiftStartedPayload = z.object({
  shiftType: z.enum(SHIFT_TYPES),
  kind: z.enum(["nurse", "head_nurse"]).optional(),
  unitId: z.string().min(1).max(80).optional(),
  unitName: z.string().min(1).max(80).optional(),
  bedLabels: z.array(z.string().min(1).max(60)).max(12).optional(),
  note: z.string().max(500).optional(),
});
export const shiftEndedPayload = z.object({ note: z.string().max(1000).optional() });
export const taskCreatedPayload = z
  .object({
    title: z.string().min(1).max(120),
    category: z.enum(["direct_care", "indirect_care"]),
    tier: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
    plannedFrom: iso,
    plannedTo: iso,
    expectedMin: z.number().int().min(0).max(720).default(5),
    intervalMin: z.number().int().min(0).max(1440).optional(),
    unitId: z.string().min(1).max(80).optional(),
    templateId: z.string().max(80).optional(),
    bedLabel: z.string().max(60).optional(),
    scope: z.enum(["bed", "shift"]).optional(),
    note: z.string().max(300).optional(),
  })
  .refine((d) => d.plannedTo >= d.plannedFrom, {
    message: "plannedTo must be >= plannedFrom",
    path: ["plannedTo"],
  });
export const taskDeferredPayload = z.object({
  reason: z.enum(["emergency", "other"]),
  emergencyId: z.string().optional(),
  note: z.string().max(300).optional(),
});
export const taskRescheduledPayload = z
  .object({
    plannedFrom: iso,
    plannedTo: iso,
    previousPlannedFrom: iso.optional(),
    previousPlannedTo: iso.optional(),
    reason: z.enum(["emergency", "manual"]).default("emergency"),
    emergencyId: z.string().optional(),
  })
  .refine((d) => d.plannedTo >= d.plannedFrom, {
    message: "plannedTo must be >= plannedFrom",
    path: ["plannedTo"],
  });
export const taskEditedPayload = z
  .object({
    title: z.string().trim().min(1).max(120).optional(),
    category: z.enum(["direct_care", "indirect_care"]).optional(),
    tier: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).optional(),
    plannedFrom: iso.optional(),
    plannedTo: iso.optional(),
    expectedMin: z.number().int().min(0).max(720).optional(),
    note: z.string().max(300).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one task field must change",
    path: ["title"],
  });
export type TaskEditPatch = z.infer<typeof taskEditedPayload>;
export const taskTimeLoggedPayload = z
  .object({
    startedAt: iso,
    endedAt: iso,
    note: z.string().max(300).optional(),
  })
  .refine((value) => value.endedAt >= value.startedAt, {
    message: "Time log end must be after its start",
    path: ["endedAt"],
  });
export const taskMissedPayload = z.object({ reason: z.enum(["timeout", "shift_end"]) });
export const taskRemovedPayload = z.object({ reason: z.string().max(200).optional() });
export const timeCorrectedPayload = z.object({
  targetEventId: z.string().min(1),
  newTs: iso,
  note: z.string().max(300).optional(),
});
export const interruptionPayload = z.object({
  reason: z.enum(INTERRUPTION_REASONS),
  startedAt: iso,
  endedAt: iso,
  note: z.string().max(300).optional(),
});
export const emergencyStartedPayload = z.object({ note: z.string().max(300).optional() });
export const emergencyEndedPayload = z.object({ note: z.string().max(300).optional() });
export const handoverPayload = z.object({
  note: z.string().max(2000).default(""),
  snapshot: z.record(z.string(), z.unknown()),
});

const base = {
  id: z.string().min(1),
  shiftId: z.string().min(1),
  bedId: z.string().optional(),
  taskId: z.string().optional(),
  actorId: z.string().min(1),
  clientTs: iso,
  serverTs: iso.optional(),
  serverSeq: z.number().int().nonnegative().optional(),
};

export const domainEventSchema = z.discriminatedUnion("type", [
  z.object({ ...base, type: z.literal("SHIFT_STARTED"), payload: shiftStartedPayload }),
  z.object({ ...base, type: z.literal("SHIFT_ENDED"), payload: shiftEndedPayload }),
  z.object({ ...base, type: z.literal("TASK_CREATED"), payload: taskCreatedPayload, taskId: z.string().min(1) }),
  z.object({ ...base, type: z.literal("TASK_STARTED"), payload: z.object({}) }),
  z.object({ ...base, type: z.literal("TASK_PAUSED"), payload: z.object({ reason: z.string().max(120).optional() }) }),
  z.object({ ...base, type: z.literal("TASK_RESUMED"), payload: z.object({}) }),
  z.object({ ...base, type: z.literal("TASK_COMPLETED"), payload: z.object({ tickOnly: z.boolean().optional() }) }),
  z.object({ ...base, type: z.literal("TASK_DEFERRED"), payload: taskDeferredPayload }),
  z.object({ ...base, type: z.literal("TASK_RESCHEDULED"), payload: taskRescheduledPayload }),
  z.object({
    ...base,
    type: z.literal("TASK_EDITED"),
    payload: taskEditedPayload,
    taskId: z.string().min(1),
  }),
  z.object({
    ...base,
    type: z.literal("TASK_TIME_LOGGED"),
    payload: taskTimeLoggedPayload,
    taskId: z.string().min(1),
  }),
  z.object({ ...base, type: z.literal("TASK_MISSED"), payload: taskMissedPayload }),
  z.object({ ...base, type: z.literal("TASK_REMOVED"), payload: taskRemovedPayload }),
  z.object({ ...base, type: z.literal("TIME_CORRECTED"), payload: timeCorrectedPayload }),
  z.object({ ...base, type: z.literal("INTERRUPTION_LOGGED"), payload: interruptionPayload }),
  z.object({ ...base, type: z.literal("EMERGENCY_STARTED"), payload: emergencyStartedPayload, bedId: z.string().min(1) }),
  z.object({ ...base, type: z.literal("EMERGENCY_ENDED"), payload: emergencyEndedPayload, bedId: z.string().min(1) }),
  z.object({ ...base, type: z.literal("HANDOVER_FINALIZED"), payload: handoverPayload, bedId: z.string().min(1) }),
]);

export type DomainEvent = z.infer<typeof domainEventSchema>;
export type EventOf<T extends EventType> = Extract<DomainEvent, { type: T }>;

export type TaskTimeLog = {
  startedAt: number;
  endedAt: number;
  note?: string;
};

export type Task = {
  id: string;
  shiftId: string;
  bedId?: string;
  scope?: TaskScope;
  unitId?: string; // NEW: optional unit assignment
  title: string;
  category: Exclude<TaskCategory, "interruption">;
  tier: Tier;
  status: TaskStatus;
  plannedFrom: number;
  plannedTo: number;
  expectedMin: number;
  intervalMin?: number;
  templateId?: string;
  createdAt: number;
  startedAt?: number;
  pausedAt?: number;
  completedAt?: number;
  missedAt?: number;
  removedAt?: number;
  rescheduledAt?: number;
  durationRecorded: boolean;
  timeLogs?: TaskTimeLog[];
  pinned: boolean;
  needsAttention: boolean;
  note?: string;
};

export type ShiftState = {
  id: string;
  actorId: string;
  type: ShiftType;
  kind?: ShiftKind;
  unitId?: string;
  unitName?: string;
  startedAt: number;
  endedAt?: number;
  note?: string;
};

export type InterruptionRecord = {
  id: string;
  shiftId: string;
  bedId?: string;
  taskId?: string;
  reason: InterruptionReason;
  startedAt: number;
  endedAt: number;
  note?: string;
};

export type EmergencyRecord = {
  id: string;
  shiftId: string;
  bedId: string;
  startedAt: number;
  endedAt?: number;
  note?: string;
};

/** Synthetic handover id for a shift-level handover (there are no bed tasks). */
export const SHIFT_HANDOVER_ID = "shift";

export type HandoverSnapshot = {
  bedId: string;
  bedLabel: string;
  shiftId: string;
  done: HandoverTask[];
  pending: HandoverTask[];
  deferred: HandoverTask[];
  missed: HandoverTask[];
  shiftTasks?: HandoverTask[];
  interruptions: { reason: InterruptionReason; label: string; count: number; minutes: number }[];
  note: string;
  generatedAt: number;
  emergencyMinutes: number;
};

export type HandoverTask = {
  id: string;
  title: string;
  tier: Tier;
  status: TaskStatus;
  plannedFrom: number;
  plannedTo: number;
  completedAt?: number;
  category: TaskCategory;
  note?: string;
};

export type ReducedState = {
  shift?: ShiftState;
  tasks: Record<string, Task>;
  interruptions: InterruptionRecord[];
  emergencies: EmergencyRecord[];
  handoverSnapshots: Record<string, HandoverSnapshot>;
};

export type AppConfig = {
  missedTimeoutMin: number;
  alertLeadMin: number;
  idleLockSec: number;
  rescheduleOffsetMode: "emergency_duration" | "fixed";
  fixedOffsetMin: number;
};

export const DEFAULT_CONFIG: AppConfig = {
  missedTimeoutMin: 30,
  alertLeadMin: 10,
  idleLockSec: 60,
  rescheduleOffsetMode: "emergency_duration",
  fixedOffsetMin: 0,
};

export type BedState = {
  shiftId: string;
  bedId: string;
  actorId: string;
  tasks: Task[];
};

export type EmergencyPlan = {
  emergencyId: string;
  events: DomainEvent[];
  pausedTaskIds: string[];
  deferredTaskIds: string[];
  flaggedTaskIds: string[];
};

export type RescheduleProposal = {
  taskId: string;
  title: string;
  oldFrom: number;
  oldTo: number;
  newFrom: number;
  newTo: number;
};

export type TaskTransition = { from: TaskStatus; event: EventType; to: TaskStatus };

export type DurationSummary = {
  byTask: Record<string, { minutes: number; category: TaskCategory }>;
  directCareMin: number;
  indirectCareMin: number;
  interruptionMin: number;
  emergencyMin: number;
  interruptionsByReason: Record<string, { count: number; minutes: number }>;
  tickOnlyTaskIds: string[];
};

export type ShiftSummary = {
  shiftId: string;
  unitId?: string;
  unitName?: string;
  startedAt: number;
  endedAt?: number;
  totalMinutes: number;
  directCareMin: number;
  indirectCareMin: number;
  interruptionMin: number;
  emergencyMin: number;
  tasksTotal: number;
  tasksDone: number;
  completionRate: number;
  tier12OnTimeRate: number;
  deferredCount: number;
  missedCount: number;
  interruptionsByReason: { reason: InterruptionReason; label: string; count: number; minutes: number }[];
  tierBreakdown: Record<Tier, { total: number; done: number }>;
};
