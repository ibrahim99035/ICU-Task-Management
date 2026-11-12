import { z } from "zod";

export type Role = "nurse" | "head_nurse";
export type Tier = 1 | 2 | 3 | 4;
export type TaskCategory = "direct_care" | "indirect_care" | "interruption";
export type TaskStatus = "planned" | "in_progress" | "paused" | "done" | "deferred" | "missed";

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
  "TASK_MISSED",
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
  bedLabels: z.array(z.string().min(1).max(60)).max(12).optional(),
  note: z.string().max(500).optional(),
});
export const shiftEndedPayload = z.object({ note: z.string().max(1000).optional() });
export const taskCreatedPayload = z.object({
  title: z.string().min(1).max(120),
  category: z.enum(["direct_care", "indirect_care"]),
  tier: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  dueAt: iso,
  expectedMin: z.number().int().min(0).max(720).default(5),
  intervalMin: z.number().int().min(0).max(1440).optional(),
  templateId: z.string().max(80).optional(),
  note: z.string().max(300).optional(),
});
export const taskDeferredPayload = z.object({
  reason: z.enum(["emergency", "other"]),
  emergencyId: z.string().optional(),
  note: z.string().max(300).optional(),
});
export const taskRescheduledPayload = z.object({
  dueAt: iso,
  previousDueAt: iso.optional(),
  reason: z.enum(["emergency", "manual"]).default("emergency"),
  emergencyId: z.string().optional(),
});
export const taskMissedPayload = z.object({ reason: z.enum(["timeout", "shift_end"]) });
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
  z.object({ ...base, type: z.literal("TASK_CREATED"), payload: taskCreatedPayload, taskId: z.string().min(1), bedId: z.string().min(1) }),
  z.object({ ...base, type: z.literal("TASK_STARTED"), payload: z.object({}) }),
  z.object({ ...base, type: z.literal("TASK_PAUSED"), payload: z.object({ reason: z.string().max(120).optional() }) }),
  z.object({ ...base, type: z.literal("TASK_RESUMED"), payload: z.object({}) }),
  z.object({ ...base, type: z.literal("TASK_COMPLETED"), payload: z.object({ tickOnly: z.boolean().optional() }) }),
  z.object({ ...base, type: z.literal("TASK_DEFERRED"), payload: taskDeferredPayload }),
  z.object({ ...base, type: z.literal("TASK_RESCHEDULED"), payload: taskRescheduledPayload }),
  z.object({ ...base, type: z.literal("TASK_MISSED"), payload: taskMissedPayload }),
  z.object({ ...base, type: z.literal("TIME_CORRECTED"), payload: timeCorrectedPayload }),
  z.object({ ...base, type: z.literal("INTERRUPTION_LOGGED"), payload: interruptionPayload }),
  z.object({ ...base, type: z.literal("EMERGENCY_STARTED"), payload: emergencyStartedPayload, bedId: z.string().min(1) }),
  z.object({ ...base, type: z.literal("EMERGENCY_ENDED"), payload: emergencyEndedPayload, bedId: z.string().min(1) }),
  z.object({ ...base, type: z.literal("HANDOVER_FINALIZED"), payload: handoverPayload, bedId: z.string().min(1) }),
]);

export type DomainEvent = z.infer<typeof domainEventSchema>;
export type EventOf<T extends EventType> = Extract<DomainEvent, { type: T }>;

export type Task = {
  id: string;
  shiftId: string;
  bedId: string;
  title: string;
  category: Exclude<TaskCategory, "interruption">;
  tier: Tier;
  status: TaskStatus;
  dueAt: number;
  expectedMin: number;
  intervalMin?: number;
  templateId?: string;
  createdAt: number;
  startedAt?: number;
  pausedAt?: number;
  completedAt?: number;
  missedAt?: number;
  rescheduledAt?: number;
  durationRecorded: boolean;
  pinned: boolean;
  needsAttention: boolean;
  note?: string;
};

export type ShiftState = {
  id: string;
  actorId: string;
  type: ShiftType;
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

export type HandoverSnapshot = {
  bedId: string;
  bedLabel: string;
  shiftId: string;
  done: HandoverTask[];
  pending: HandoverTask[];
  deferred: HandoverTask[];
  missed: HandoverTask[];
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
  dueAt: number;
  completedAt?: number;
  category: TaskCategory;
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
  oldDue: number;
  newDue: number;
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
