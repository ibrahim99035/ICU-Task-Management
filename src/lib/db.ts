"use client";

import Dexie, { type EntityTable } from "dexie";
import type {
  AppConfig,
  DomainEvent,
  HandoverSnapshot,
  Task,
  ShiftType,
} from "@/domain";

export type ShiftRow = {
  id: string;
  actorId: string;
  type: ShiftType;
  startedAt: number;
  endedAt?: number;
  summary?: unknown;
  syncedAt?: number;
};

export type BedRow = {
  id: string;
  shiftId: string;
  label: string;
  alias: string;
  templateIds: string[];
};

export type TemplateRow = {
  id: string;
  name: string;
  category: "direct_care" | "indirect_care";
  tier: 1 | 2 | 3 | 4;
  intervalMin: number;
  expectedMin: number;
  offsetMin: number;
  active: boolean;
};

export type ReviewRow = {
  id: string;
  shiftId: string;
  scores: {
    completion: number;
    critical_timeliness: number;
    interruption_handling: number;
    handover_quality: number;
    documentation: number;
  };
  comment: string;
  needsSupport: boolean;
  createdAt: number;
  reviewerName?: string;
  shiftStartedAt?: number;
};

export type HandoverRow = {
  id: string;
  shiftId: string;
  bedId: string;
  snapshot: HandoverSnapshot;
  note: string;
  createdAt: number;
};

export type OutboxItem = {
  id: string;
  kind: "event" | "survey";
  payload: unknown;
  createdAt: number;
};

export type SessionRow = {
  key: string;
  value: unknown;
};

export type ActiveInterruption = {
  taskId?: string;
  bedId: string;
  shiftId: string;
  reason: string;
  startedAt: number;
  wasRunning: boolean;
};

export type SessionUser = {
  id: string;
  username: string;
  role: "nurse" | "head_nurse";
  displayName: string;
  participantCode: string;
};

export type AuthRecord = {
  user: SessionUser;
  token: string;
  savedAt: number;
};

class IcuDatabase extends Dexie {
  events!: EntityTable<DomainEvent, "id">;
  tasks!: EntityTable<Task, "id">;
  outbox!: EntityTable<OutboxItem, "id">;
  templates!: EntityTable<TemplateRow, "id">;
  session!: EntityTable<SessionRow, "key">;
  reviews!: EntityTable<ReviewRow, "id">;
  handovers!: EntityTable<HandoverRow, "id">;
  shifts!: EntityTable<ShiftRow, "id">;
  beds!: EntityTable<BedRow, "id">;

  constructor() {
    super("icu-tasklog");
    this.version(1).stores({
      events: "id, shiftId, taskId, serverSeq, clientTs",
      tasks: "id, shiftId, bedId, status, tier, dueAt",
      outbox: "id, kind, createdAt",
      templates: "id, tier, category",
      session: "key",
      reviews: "id, shiftId",
      handovers: "id, shiftId, bedId",
      shifts: "id, actorId, startedAt, endedAt",
      beds: "id, shiftId",
    });
  }
}

let instance: IcuDatabase | undefined;

export function db(): IcuDatabase {
  if (typeof window === "undefined") throw new Error("Dexie is browser-only");
  instance ??= new IcuDatabase();
  return instance;
}

export async function getSessionValue<T>(key: string): Promise<T | undefined> {
  const row = await db().session.get(key);
  return row?.value as T | undefined;
}

export async function setSessionValue(key: string, value: unknown): Promise<void> {
  await db().session.put({ key, value });
}

export async function getAuth(): Promise<AuthRecord | undefined> {
  return getSessionValue<AuthRecord>("auth");
}

export async function setAuth(auth: AuthRecord): Promise<void> {
  await setSessionValue("auth", auth);
}

export async function clearAuth(): Promise<void> {
  await db().session.delete("auth");
}

export async function getConfig(): Promise<AppConfig> {
  return (
    (await getSessionValue<AppConfig>("config")) ?? {
      missedTimeoutMin: 30,
      alertLeadMin: 10,
      idleLockSec: 60,
      rescheduleOffsetMode: "emergency_duration",
      fixedOffsetMin: 0,
    }
  );
}

export async function activeShift(actorId: string): Promise<ShiftRow | undefined> {
  const rows = await db().shifts.where("actorId").equals(actorId).toArray();
  return rows.filter((s) => !s.endedAt).sort((a, b) => b.startedAt - a.startedAt)[0];
}
