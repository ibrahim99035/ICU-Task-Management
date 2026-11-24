import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const users = pgTable(
  "users",
  {
    id: text("id").primaryKey(),
    username: text("username").notNull(),
    pinHash: text("pin_hash").notNull(),
    role: text("role", { enum: ["nurse", "head_nurse"] }).notNull(),
    displayName: text("display_name").notNull(),
    participantCode: text("participant_code").notNull(),
  },
  (table) => [
    uniqueIndex("users_username_uq").on(table.username),
    uniqueIndex("users_participant_uq").on(table.participantCode),
  ],
);

export const units = pgTable(
  "units",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    status: text("status", { enum: ["active", "inactive"] }).notNull().default("active"),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
    updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
  },
  (table) => [
    uniqueIndex("units_name_lower_uq").on(sql`lower(${table.name})`),
    index("units_status_idx").on(table.status),
  ],
);

export const unitNurses = pgTable(
  "unit_nurses",
  {
    unitId: text("unit_id")
      .notNull()
      .references(() => units.id, { onDelete: "cascade" }),
    nurseId: text("nurse_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    assignedBy: text("assigned_by")
      .notNull()
      .references(() => users.id),
    assignedAt: bigint("assigned_at", { mode: "number" }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.unitId, table.nurseId] }),
    index("unit_nurses_nurse_idx").on(table.nurseId),
  ],
);

export const shifts = pgTable(
  "shifts",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    unitId: text("unit_id").references(() => units.id),
    type: text("type").notNull(),
    kind: text("kind", { enum: ["nurse", "head_nurse"] }).notNull().default("nurse"),
    startedAt: bigint("started_at", { mode: "number" }).notNull(),
    endedAt: bigint("ended_at", { mode: "number" }),
    summary: jsonb("summary"),
  },
  (table) => [
    index("shifts_user_idx").on(table.userId),
    index("shifts_started_idx").on(table.startedAt),
    index("shifts_unit_idx").on(table.unitId),
  ],
);

export const beds = pgTable(
  "beds",
  {
    id: text("id").primaryKey(),
    shiftId: text("shift_id")
      .notNull()
      .references(() => shifts.id),
    label: text("label").notNull(),
    alias: text("alias").notNull(),
  },
  (table) => [index("beds_shift_idx").on(table.shiftId)],
);

export const taskTemplates = pgTable("task_templates", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  category: text("category").notNull(),
  tier: integer("tier").notNull(),
  intervalMin: integer("interval_min").notNull(),
  expectedMin: integer("expected_min").notNull(),
  offsetMin: integer("offset_min").notNull().default(0),
  active: boolean("active").notNull().default(true),
  role: text("role", { enum: ["nurse", "head_nurse"] }).notNull().default("nurse"),
  scope: text("scope", { enum: ["bed", "shift"] }).notNull().default("bed"),
});

export const events = pgTable(
  "events",
  {
    id: text("id").primaryKey(),
    shiftId: text("shift_id").notNull(),
    bedId: text("bed_id"),
    taskId: text("task_id"),
    actorId: text("actor_id").notNull(),
    type: text("type").notNull(),
    payload: jsonb("payload").notNull(),
    clientTs: bigint("client_ts", { mode: "number" }).notNull(),
    serverTs: bigint("server_ts", { mode: "number" }).notNull(),
    serverSeq: bigserial("server_seq", { mode: "number" }).notNull(),
  },
  (table) => [
    uniqueIndex("events_server_seq_uq").on(table.serverSeq),
    index("events_shift_idx").on(table.shiftId),
    index("events_actor_idx").on(table.actorId),
  ],
);

export const handoverReports = pgTable(
  "handover_reports",
  {
    id: text("id").primaryKey(),
    shiftId: text("shift_id").notNull(),
    bedId: text("bed_id").notNull(),
    snapshot: jsonb("snapshot").notNull(),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
  },
  (table) => [index("handovers_shift_idx").on(table.shiftId)],
);

export const shiftReviews = pgTable(
  "shift_reviews",
  {
    id: text("id").primaryKey(),
    shiftId: text("shift_id").notNull(),
    nurseId: text("nurse_id").notNull(),
    reviewerId: text("reviewer_id").notNull(),
    scores: jsonb("scores").notNull(),
    comment: text("comment").notNull().default(""),
    needsSupport: boolean("needs_support").notNull().default(false),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
  },
  (table) => [
    uniqueIndex("reviews_shift_uq").on(table.shiftId),
    index("reviews_nurse_idx").on(table.nurseId),
  ],
);

export const surveyResponses = pgTable(
  "survey_responses",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    participantCode: text("participant_code").notNull(),
    instrument: text("instrument").notNull(),
    phase: text("phase").notNull(),
    answers: jsonb("answers").notNull(),
    score: text("score").notNull(),
    takenAt: bigint("taken_at", { mode: "number" }).notNull(),
  },
  (table) => [index("survey_instrument_idx").on(table.instrument)],
);

export const config = pgTable("config", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
});
