import { and, asc, desc, eq, gt, gte, inArray, lte } from "drizzle-orm";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { type MiddlewareHandler } from "hono";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getDb, hasDatabase, schema } from "@/db";
import {
  buildShiftSummary,
  domainEventSchema,
  scoreRawTLX,
  scoreSUS,
  type DomainEvent,
  type ShiftSummary,
} from "@/domain";
import { hashPin, verifyPin, verifyToken, signToken, type AuthUser } from "./auth";

type AppEnv = { Variables: { auth: AuthUser } };

const app = new Hono<AppEnv>().basePath("/api");

function dbOrThrow() {
  const db = getDb();
  if (!db) throw new HTTPException(503, { message: "Database is not configured" });
  return db;
}

function isUniqueViolation(error: unknown): boolean {
  const value = error as { code?: string; cause?: { code?: string } } | null;
  return value?.code === "23505" || value?.cause?.code === "23505";
}

function allowedOrigins(): string[] {
  return (process.env.ALLOWED_ORIGINS ?? "http://localhost:3000,https://localhost,capacitor://localhost")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

app.use(
  "*",
  cors({
    origin: (origin) => {
      const allowed = allowedOrigins();
      if (!origin) return allowed[0] ?? "*";
      return allowed.includes(origin) ? origin : allowed[0] ?? "http://localhost:3000";
    },
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "OPTIONS"],
    maxAge: 600,
  }),
);

app.use("*", async (c, next) => {
  if (c.req.method === "OPTIONS") return next();
  const path = c.req.path.replace(/\/+$/, "") || "/";
  if (
    path.endsWith("/health") ||
    path.endsWith("/auth/login") ||
    path.endsWith("/auth/register")
  ) {
    return next();
  }
  const header = c.req.header("Authorization");
  if (!header?.startsWith("Bearer ")) {
    throw new HTTPException(401, { message: "Missing bearer token" });
  }
  try {
    const user = await verifyToken(header.slice(7));
    c.set("auth", user);
  } catch {
    throw new HTTPException(401, { message: "Invalid or expired session" });
  }
  await next();
});

function requireRole(...roles: AuthUser["role"][]): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const auth = c.get("auth");
    if (!roles.includes(auth.role)) throw new HTTPException(403, { message: "Role not permitted" });
    await next();
  };
}

app.onError((err, c) => {
  if (err instanceof HTTPException) {
    return c.json({ error: err.message }, err.status);
  }
  if (err instanceof z.ZodError) {
    return c.json({ error: "Validation failed", issues: err.issues }, 400);
  }
  console.error(err);
  return c.json({ error: "Unexpected server error" }, 500);
});

app.get("/health", (c) =>
  c.json({ ok: true, database: hasDatabase(), time: new Date().toISOString() }),
);

app.post("/auth/login", async (c) => {
  const body = z
    .object({ username: z.string().min(1).max(40), pin: z.string().min(4).max(8) })
    .parse(await c.req.json());
  const db = dbOrThrow();
  const [user] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.username, body.username.trim().toLowerCase()))
    .limit(1);
  if (!user || !(await verifyPin(body.pin, user.pinHash))) {
    return c.json({ error: "Incorrect username or PIN" }, 401);
  }
  const auth: AuthUser = {
    id: user.id,
    username: user.username,
    role: user.role,
    displayName: user.displayName,
    participantCode: user.participantCode,
  };
  const token = await signToken(auth);
  return c.json({ token, user: auth, expiresInSec: 1800 });
});

app.post("/auth/register", async (c) => {
  const body = z
    .object({
      username: z
        .string()
        .trim()
        .min(3, "Username must be at least 3 characters")
        .max(40, "Username is too long")
        .regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/, "Use letters, numbers, dots, dashes or underscores"),
      displayName: z
        .string()
        .trim()
        .min(2, "Display name must be at least 2 characters")
        .max(40, "Display name is too long"),
      pin: z.string().regex(/^\d{4,8}$/, "PIN must be 4–8 digits"),
    })
    .strict()
    .parse(await c.req.json());

  const db = dbOrThrow();
  const username = body.username.toLowerCase();
  const [existing] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.username, username))
    .limit(1);
  if (existing) {
    return c.json({ error: "That username is already taken" }, 409);
  }

  const auth: AuthUser = {
    id: `u-${randomUUID()}`,
    username,
    role: "nurse",
    displayName: body.displayName,
    participantCode: `N-${randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}`,
  };
  const pinHash = await hashPin(body.pin);

  try {
    await db.insert(schema.users).values({ ...auth, pinHash });
  } catch (error) {
    if (isUniqueViolation(error)) {
      const [duplicate] = await db
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(eq(schema.users.username, username))
        .limit(1);
      return c.json(
        {
          error: duplicate
            ? "That username is already taken"
            : "Could not create the account. Please try again.",
        },
        409,
      );
    }
    throw error;
  }

  const token = await signToken(auth);
  return c.json({ token, user: auth, expiresInSec: 1800 }, 201);
});

app.get("/me", (c) => c.json({ user: c.get("auth") }));

/* ------------------------------------------------------------------ */
/* Sync                                                                */
/* ------------------------------------------------------------------ */

const pushBody = z.object({ events: z.array(domainEventSchema).min(1).max(500) });

app.post("/sync/push", requireRole("nurse"), async (c) => {
  const auth = c.get("auth");
  const body = pushBody.parse(await c.req.json());
  const db = dbOrThrow();
  const events = body.events as DomainEvent[];
  for (const event of events) {
    if (event.actorId !== auth.id) {
      return c.json({ error: "Event actor does not match the signed-in nurse" }, 403);
    }
  }

  const shiftIds = [...new Set(events.map((e) => e.shiftId))];
  const existing = await db
    .select({ id: schema.shifts.id, userId: schema.shifts.userId })
    .from(schema.shifts)
    .where(inArray(schema.shifts.id, shiftIds));
  for (const shift of existing) {
    if (shift.userId !== auth.id) {
      return c.json({ error: "A nurse cannot write to another nurse's shift" }, 403);
    }
  }
  const knownShifts = new Set(existing.map((s) => s.id));
  const starts = events.filter(
    (e): e is Extract<DomainEvent, { type: "SHIFT_STARTED" }> => e.type === "SHIFT_STARTED",
  );
  for (const start of starts) {
    if (!knownShifts.has(start.shiftId)) {
      await db
        .insert(schema.shifts)
        .values({
          id: start.shiftId,
          userId: auth.id,
          type: start.payload.shiftType,
          startedAt: start.clientTs,
        })
        .onConflictDoNothing();
      knownShifts.add(start.shiftId);
    }
  }
  for (const event of events) {
    if (!knownShifts.has(event.shiftId)) {
      return c.json({ error: `Shift ${event.shiftId} has not been started` }, 400);
    }
  }

  const bedRows = new Map<string, { id: string; shiftId: string; label: string; alias: string }>();
  for (const event of events) {
    if (event.type === "TASK_CREATED" && event.bedId) {
      bedRows.set(event.bedId, {
        id: event.bedId,
        shiftId: event.shiftId,
        label: event.payload.bedLabel ?? "Bed",
        alias: event.payload.bedLabel ?? "Bed",
      });
    }
  }
  if (bedRows.size) {
    await db.insert(schema.beds).values([...bedRows.values()]).onConflictDoNothing();
  }

  const now = Date.now();
  const inserted = await db
    .insert(schema.events)
    .values(
      events.map((event) => ({
        id: event.id,
        shiftId: event.shiftId,
        bedId: event.bedId ?? null,
        taskId: event.taskId ?? null,
        actorId: event.actorId,
        type: event.type,
        payload: event.payload,
        clientTs: event.clientTs,
        serverTs: now,
      })),
    )
    .onConflictDoNothing({ target: schema.events.id })
    .returning({ id: schema.events.id });

  // If this batch ended a shift, recompute the summary from stored timestamps.
  const endedShiftIds = new Set(
    events.filter((e) => e.type === "SHIFT_ENDED").map((e) => e.shiftId),
  );
  for (const shiftId of endedShiftIds) {
    const stored = await db.select().from(schema.events).where(eq(schema.events.shiftId, shiftId));
    const domainEvents = stored.map((row) => ({
      id: row.id,
      shiftId: row.shiftId,
      bedId: row.bedId ?? undefined,
      taskId: row.taskId ?? undefined,
      actorId: row.actorId,
      type: row.type,
      payload: row.payload,
      clientTs: row.clientTs,
      serverTs: row.serverTs,
      serverSeq: row.serverSeq,
    })) as DomainEvent[];
    try {
      const summary = buildShiftSummary(domainEvents);
      await db
        .update(schema.shifts)
        .set({ endedAt: summary.endedAt ?? now, summary })
        .where(and(eq(schema.shifts.id, shiftId), eq(schema.shifts.userId, auth.id)));
    } catch (error) {
      console.error("Could not build summary", shiftId, error);
    }
  }

  return c.json({
    accepted: events.map((e) => e.id),
    inserted: inserted.length,
    duplicates: events.length - inserted.length,
    serverTs: now,
  });
});

app.get("/sync/pull", async (c) => {
  const auth = c.get("auth");
  const db = dbOrThrow();
  const cursor = Math.max(0, Number(c.req.query("cursor") ?? 0) || 0);
  const templates = await db.select().from(schema.taskTemplates);
  const [configRow] = await db.select().from(schema.config).where(eq(schema.config.key, "app")).limit(1);

  if (auth.role === "nurse") {
    const myShifts = await db
      .select()
      .from(schema.shifts)
      .where(eq(schema.shifts.userId, auth.id));
    const shiftIds = myShifts.map((s) => s.id);
    const eventRows = shiftIds.length
      ? await db
          .select()
          .from(schema.events)
          .where(and(inArray(schema.events.shiftId, shiftIds), gt(schema.events.serverSeq, cursor)))
          .orderBy(asc(schema.events.serverSeq))
          .limit(2000)
      : [];
    const events = eventRows.map((row) => ({
      id: row.id,
      shiftId: row.shiftId,
      bedId: row.bedId ?? undefined,
      taskId: row.taskId ?? undefined,
      actorId: row.actorId,
      type: row.type,
      payload: row.payload,
      clientTs: row.clientTs,
      serverTs: row.serverTs,
      serverSeq: row.serverSeq,
    }));
    const beds = shiftIds.length
      ? await db.select().from(schema.beds).where(inArray(schema.beds.shiftId, shiftIds))
      : [];
    const reviews = await db
      .select()
      .from(schema.shiftReviews)
      .where(eq(schema.shiftReviews.nurseId, auth.id))
      .orderBy(desc(schema.shiftReviews.createdAt));
    const handovers = shiftIds.length
      ? await db.select().from(schema.handoverReports).where(inArray(schema.handoverReports.shiftId, shiftIds))
      : [];
    const nextCursor = events.length ? Math.max(...events.map((e) => e.serverSeq ?? 0)) : cursor;
    return c.json({
      cursor: nextCursor,
      templates,
      config: configRow?.value ?? null,
      shifts: myShifts,
      beds,
      events,
      reviews,
      handovers,
    });
  }

  // Head nurse gets unit-level context. The detail screens use /shifts.
  const shifts = await db.select().from(schema.shifts).orderBy(desc(schema.shifts.startedAt)).limit(200);
  const reviews = await db.select().from(schema.shiftReviews).orderBy(desc(schema.shiftReviews.createdAt));
  return c.json({
    cursor,
    templates,
    config: configRow?.value ?? null,
    shifts,
    reviews,
    events: [],
    beds: [],
    handovers: [],
  });
});

/* ------------------------------------------------------------------ */
/* Shifts, handovers, reviews                                          */
/* ------------------------------------------------------------------ */

app.get("/shifts", requireRole("head_nurse"), async (c) => {
  const db = dbOrThrow();
  const nurseId = c.req.query("nurseId");
  const from = c.req.query("from");
  const to = c.req.query("to");
  const conditions = [];
  if (nurseId) conditions.push(eq(schema.shifts.userId, nurseId));
  if (from) conditions.push(gte(schema.shifts.startedAt, new Date(`${from}T00:00:00`).getTime()));
  if (to) conditions.push(lte(schema.shifts.startedAt, new Date(`${to}T23:59:59`).getTime()));
  const rows = await db
    .select({
      id: schema.shifts.id,
      userId: schema.shifts.userId,
      type: schema.shifts.type,
      startedAt: schema.shifts.startedAt,
      endedAt: schema.shifts.endedAt,
      summary: schema.shifts.summary,
      nurseName: schema.users.displayName,
      participantCode: schema.users.participantCode,
      reviewId: schema.shiftReviews.id,
      needsSupport: schema.shiftReviews.needsSupport,
    })
    .from(schema.shifts)
    .innerJoin(schema.users, eq(schema.users.id, schema.shifts.userId))
    .leftJoin(schema.shiftReviews, eq(schema.shiftReviews.shiftId, schema.shifts.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(schema.shifts.startedAt))
    .limit(200);
  return c.json({ shifts: rows });
});

app.get("/shifts/:id", requireRole("head_nurse"), async (c) => {
  const db = dbOrThrow();
  const id = c.req.param("id");
  const [shift] = await db
    .select({
      id: schema.shifts.id,
      userId: schema.shifts.userId,
      type: schema.shifts.type,
      startedAt: schema.shifts.startedAt,
      endedAt: schema.shifts.endedAt,
      summary: schema.shifts.summary,
      nurseName: schema.users.displayName,
      participantCode: schema.users.participantCode,
    })
    .from(schema.shifts)
    .innerJoin(schema.users, eq(schema.users.id, schema.shifts.userId))
    .where(eq(schema.shifts.id, id))
    .limit(1);
  if (!shift) return c.json({ error: "Shift not found" }, 404);
  const eventRows = await db
    .select()
    .from(schema.events)
    .where(eq(schema.events.shiftId, id))
    .orderBy(asc(schema.events.clientTs), asc(schema.events.serverSeq));
  const beds = await db.select().from(schema.beds).where(eq(schema.beds.shiftId, id));
  const handovers = await db.select().from(schema.handoverReports).where(eq(schema.handoverReports.shiftId, id));
  const [review] = await db.select().from(schema.shiftReviews).where(eq(schema.shiftReviews.shiftId, id)).limit(1);
  return c.json({ shift, events: eventRows, beds, handovers, review: review ?? null });
});

app.post("/shifts/:id/summary", requireRole("nurse"), async (c) => {
  const auth = c.get("auth");
  const db = dbOrThrow();
  const id = c.req.param("id");
  const [shift] = await db.select().from(schema.shifts).where(eq(schema.shifts.id, id)).limit(1);
  if (!shift) return c.json({ error: "Shift not found" }, 404);
  if (shift.userId !== auth.id) return c.json({ error: "Not your shift" }, 403);
  const rows = await db.select().from(schema.events).where(eq(schema.events.shiftId, id)).orderBy(asc(schema.events.serverSeq));
  const events = rows.map((row) => ({
    id: row.id,
    shiftId: row.shiftId,
    bedId: row.bedId ?? undefined,
    taskId: row.taskId ?? undefined,
    actorId: row.actorId,
    type: row.type,
    payload: row.payload,
    clientTs: row.clientTs,
    serverTs: row.serverTs,
    serverSeq: row.serverSeq,
  })) as DomainEvent[];
  const summary = buildShiftSummary(events);
  await db
    .update(schema.shifts)
    .set({ endedAt: summary.endedAt ?? Date.now(), summary })
    .where(eq(schema.shifts.id, id));
  return c.json({ summary });
});

app.post("/handovers", requireRole("nurse"), async (c) => {
  const auth = c.get("auth");
  const db = dbOrThrow();
  const body = z
    .object({
      id: z.string().min(1),
      shiftId: z.string().min(1),
      bedId: z.string().min(1),
      snapshot: z.record(z.string(), z.unknown()),
      note: z.string().max(2000).default(""),
      createdAt: z.number().int(),
    })
    .parse(await c.req.json());
  const [shift] = await db.select().from(schema.shifts).where(eq(schema.shifts.id, body.shiftId)).limit(1);
  if (!shift) {
    await db
      .insert(schema.shifts)
      .values({ id: body.shiftId, userId: auth.id, type: "day", startedAt: body.createdAt })
      .onConflictDoNothing();
  } else if (shift.userId !== auth.id) {
    return c.json({ error: "Not your shift" }, 403);
  }
  await db
    .insert(schema.handoverReports)
    .values({
      id: body.id,
      shiftId: body.shiftId,
      bedId: body.bedId,
      snapshot: body.snapshot,
      createdAt: body.createdAt,
    })
    .onConflictDoNothing();
  return c.json({ accepted: body.id });
});

app.post("/reviews", requireRole("head_nurse"), async (c) => {
  const auth = c.get("auth");
  const db = dbOrThrow();
  const scores = z.object({
    completion: z.number().int().min(1).max(5),
    critical_timeliness: z.number().int().min(1).max(5),
    interruption_handling: z.number().int().min(1).max(5),
    handover_quality: z.number().int().min(1).max(5),
    documentation: z.number().int().min(1).max(5),
  });
  const body = z
    .object({
      id: z.string().min(1),
      shiftId: z.string().min(1),
      scores,
      comment: z.string().max(2000).default(""),
      needsSupport: z.boolean().default(false),
      createdAt: z.number().int(),
    })
    .parse(await c.req.json());
  const [shift] = await db.select().from(schema.shifts).where(eq(schema.shifts.id, body.shiftId)).limit(1);
  if (!shift) return c.json({ error: "Shift not found" }, 404);
  if (shift.endedAt === null) return c.json({ error: "Shift is not finished" }, 400);
  await db
    .insert(schema.shiftReviews)
    .values({
      id: body.id,
      shiftId: body.shiftId,
      nurseId: shift.userId,
      reviewerId: auth.id,
      scores: body.scores,
      comment: body.comment,
      needsSupport: body.needsSupport,
      createdAt: body.createdAt,
    })
    .onConflictDoNothing();
  return c.json({ accepted: body.id });
});

app.get("/reviews/mine", requireRole("nurse"), async (c) => {
  const auth = c.get("auth");
  const db = dbOrThrow();
  const rows = await db
    .select({
      id: schema.shiftReviews.id,
      shiftId: schema.shiftReviews.shiftId,
      scores: schema.shiftReviews.scores,
      comment: schema.shiftReviews.comment,
      needsSupport: schema.shiftReviews.needsSupport,
      createdAt: schema.shiftReviews.createdAt,
      reviewerName: schema.users.displayName,
      shiftStartedAt: schema.shifts.startedAt,
    })
    .from(schema.shiftReviews)
    .innerJoin(schema.users, eq(schema.users.id, schema.shiftReviews.reviewerId))
    .innerJoin(schema.shifts, eq(schema.shifts.id, schema.shiftReviews.shiftId))
    .where(eq(schema.shiftReviews.nurseId, auth.id))
    .orderBy(desc(schema.shiftReviews.createdAt));
  return c.json({ reviews: rows });
});

/* ------------------------------------------------------------------ */
/* Analytics, surveys, exports                                         */
/* ------------------------------------------------------------------ */

app.get("/analytics/unit", requireRole("head_nurse"), async (c) => {
  const db = dbOrThrow();
  const days = Math.min(90, Math.max(1, Number(c.req.query("days") ?? 30) || 30));
  const since = Date.now() - days * 86_400_000;
  const rows = await db
    .select({ summary: schema.shifts.summary, startedAt: schema.shifts.startedAt, endedAt: schema.shifts.endedAt })
    .from(schema.shifts)
    .where(gte(schema.shifts.startedAt, since));
  const summaries = rows.map((r) => r.summary).filter(Boolean) as ShiftSummary[];
  const avg = (pick: (s: ShiftSummary) => number) =>
    summaries.length ? summaries.reduce((sum, s) => sum + pick(s), 0) / summaries.length : 0;
  const reasons = new Map<string, { label: string; count: number; minutes: number }>();
  for (const summary of summaries) {
    for (const item of summary.interruptionsByReason ?? []) {
      const prev = reasons.get(item.reason) ?? { label: item.label, count: 0, minutes: 0 };
      reasons.set(item.reason, {
        label: item.label,
        count: prev.count + item.count,
        minutes: prev.minutes + item.minutes,
      });
    }
  }
  return c.json({
    days,
    shifts: summaries.length,
    avgDirectCareMin: Math.round(avg((s) => s.directCareMin) * 10) / 10,
    avgIndirectCareMin: Math.round(avg((s) => s.indirectCareMin) * 10) / 10,
    avgInterruptionMin: Math.round(avg((s) => s.interruptionMin) * 10) / 10,
    avgEmergencyMin: Math.round(avg((s) => s.emergencyMin) * 10) / 10,
    avgCompletionRate: Math.round(avg((s) => s.completionRate) * 1000) / 1000,
    avgTier12OnTimeRate: Math.round(avg((s) => s.tier12OnTimeRate) * 1000) / 1000,
    totalMissed: summaries.reduce((sum, s) => sum + (s.missedCount ?? 0), 0),
    totalDeferred: summaries.reduce((sum, s) => sum + (s.deferredCount ?? 0), 0),
    topInterruptions: [...reasons.entries()]
      .map(([reason, value]) => ({ reason, ...value }))
      .sort((a, b) => b.minutes - a.minutes)
      .slice(0, 6),
  });
});

app.post("/surveys", async (c) => {
  const auth = c.get("auth");
  const db = dbOrThrow();
  const body = z
    .object({
      id: z.string().min(1),
      instrument: z.enum(["SUS", "TLX"]),
      phase: z.enum(["paper", "app"]),
      answers: z.array(z.number()),
      takenAt: z.number().int(),
    })
    .parse(await c.req.json());
  const score = body.instrument === "SUS" ? scoreSUS(body.answers) : scoreRawTLX(body.answers);
  await db
    .insert(schema.surveyResponses)
    .values({
      id: body.id,
      userId: auth.id,
      participantCode: auth.participantCode,
      instrument: body.instrument,
      phase: body.phase,
      answers: body.answers,
      score: String(score),
      takenAt: body.takenAt,
    })
    .onConflictDoNothing();
  return c.json({ accepted: body.id, score });
});

app.get("/export", requireRole("head_nurse"), async (c) => {
  const db = dbOrThrow();
  const type = c.req.query("type") ?? "summaries";
  let header: string[] = [];
  let rows: (string | number | boolean | null | undefined)[][] = [];
  if (type === "events") {
    const data = await db.select().from(schema.events).orderBy(asc(schema.events.serverSeq));
    header = ["id", "shift_id", "bed_id", "task_id", "actor_id", "type", "client_ts", "server_ts", "payload"];
    rows = data.map((r) => [r.id, r.shiftId, r.bedId, r.taskId, r.actorId, r.type, r.clientTs, r.serverTs, JSON.stringify(r.payload)]);
  } else if (type === "summaries") {
    const data = await db
      .select({ id: schema.shifts.id, userId: schema.shifts.userId, type: schema.shifts.type, startedAt: schema.shifts.startedAt, endedAt: schema.shifts.endedAt, summary: schema.shifts.summary })
      .from(schema.shifts)
      .orderBy(desc(schema.shifts.startedAt));
    header = ["shift_id", "nurse_id", "shift_type", "started_at", "ended_at", "direct_care_min", "indirect_care_min", "interruption_min", "emergency_min", "completion_rate", "tier12_on_time_rate", "missed", "deferred"];
    rows = data.map((r) => {
      const s = r.summary as ShiftSummary | null;
      return [r.id, r.userId, r.type, r.startedAt, r.endedAt, s?.directCareMin, s?.indirectCareMin, s?.interruptionMin, s?.emergencyMin, s?.completionRate, s?.tier12OnTimeRate, s?.missedCount, s?.deferredCount];
    });
  } else if (type === "surveys") {
    const data = await db.select().from(schema.surveyResponses).orderBy(desc(schema.surveyResponses.takenAt));
    header = ["id", "participant_code", "instrument", "phase", "score", "taken_at", "answers"];
    rows = data.map((r) => [r.id, r.participantCode, r.instrument, r.phase, r.score, r.takenAt, JSON.stringify(r.answers)]);
  } else if (type === "reviews") {
    const data = await db.select().from(schema.shiftReviews).orderBy(desc(schema.shiftReviews.createdAt));
    header = ["id", "shift_id", "nurse_id", "reviewer_id", "scores", "comment", "needs_support", "created_at"];
    rows = data.map((r) => [r.id, r.shiftId, r.nurseId, r.reviewerId, JSON.stringify(r.scores), r.comment, r.needsSupport, r.createdAt]);
  } else {
    return c.json({ error: "Unknown export type" }, 400);
  }
  const escape = (value: unknown) => {
    const text = value === null || value === undefined ? "" : String(value);
    return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  const csv = [header, ...rows].map((row) => row.map(escape).join(",")).join("\n");
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="icu-tasklog-${type}.csv"`,
    },
  });
});

export { app };
export type { AppEnv };
