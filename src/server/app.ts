import { and, asc, desc, eq, gt, gte, inArray, isNull, lte } from "drizzle-orm";
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
  isTaskEditable,
  MAX_SHIFT_HOURS,
  MAX_SHIFT_MS,
  nextRecurringTask,
  reduce,
  scoreRawTLX,
  scoreSUS,
  taskEditedPayload,
  taskTimeLoggedPayload,
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

async function loadShiftEvents(db: ReturnType<typeof dbOrThrow>, shiftId: string): Promise<DomainEvent[]> {
  const rows = await db
    .select()
    .from(schema.events)
    .where(eq(schema.events.shiftId, shiftId))
    .orderBy(asc(schema.events.serverSeq));
  return rows.map((row) => ({
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
}


async function closeHeadShiftAt(
  db: ReturnType<typeof dbOrThrow>,
  shift: { id: string; startedAt: number },
  actorId: string,
  endedAt: number,
  note: string,
): Promise<ShiftSummary> {
  const events = await loadShiftEvents(db, shift.id);
  const state = reduce(events);
  const newEvents: DomainEvent[] = [];
  for (const task of Object.values(state.tasks)) {
    if (["planned", "in_progress", "paused"].includes(task.status)) {
      newEvents.push({
        id: randomUUID(),
        shiftId: shift.id,
        bedId: task.bedId,
        taskId: task.id,
        actorId,
        type: "TASK_MISSED",
        clientTs: endedAt,
        payload: { reason: "shift_end" },
      });
    }
  }
  newEvents.push({
    id: randomUUID(),
    shiftId: shift.id,
    actorId,
    type: "SHIFT_ENDED",
    clientTs: endedAt,
    payload: { note },
  });
  const summary = buildShiftSummary([...events, ...newEvents], endedAt);
  const serverTs = Date.now();
  await db.insert(schema.events).values(
    newEvents.map((event) => ({
      id: event.id,
      shiftId: event.shiftId,
      bedId: event.bedId ?? null,
      taskId: event.taskId ?? null,
      actorId: event.actorId,
      type: event.type,
      payload: event.payload,
      clientTs: event.clientTs,
      serverTs,
    })),
  );
  await db
    .update(schema.shifts)
    .set({ endedAt: summary.endedAt ?? endedAt, summary })
    .where(eq(schema.shifts.id, shift.id));
  return summary;
}

async function autoEndExpiredHeadShifts(
  db: ReturnType<typeof dbOrThrow>,
  actorId: string,
): Promise<void> {
  const rows = await db
    .select()
    .from(schema.shifts)
    .where(
      and(
        eq(schema.shifts.userId, actorId),
        eq(schema.shifts.kind, "head_nurse"),
        isNull(schema.shifts.endedAt),
      ),
    );
  for (const row of rows) {
    const limitEnd = row.startedAt + MAX_SHIFT_MS;
    if (Date.now() >= limitEnd) {
      await closeHeadShiftAt(
        db,
        row,
        actorId,
        limitEnd,
        `Auto-ended: maximum shift length of ${MAX_SHIFT_HOURS} hours reached`,
      );
    }
  }
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
    allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
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
/* Units and nurse assignment                                          */
/* ------------------------------------------------------------------ */

const unitInput = z.object({
  name: z.string().trim().min(1, "Unit name is required").max(80),
  description: z.string().trim().max(240).optional().default(""),
});

app.get("/units", async (c) => {
  const auth = c.get("auth");
  const db = dbOrThrow();
  if (auth.role === "head_nurse") {
    const rows = await db.select().from(schema.units).orderBy(asc(schema.units.name));
    return c.json({ units: rows });
  }
  const rows = await db
    .select({
      id: schema.units.id,
      name: schema.units.name,
      description: schema.units.description,
      status: schema.units.status,
      createdAt: schema.units.createdAt,
      updatedAt: schema.units.updatedAt,
    })
    .from(schema.unitNurses)
    .innerJoin(schema.units, eq(schema.units.id, schema.unitNurses.unitId))
    .where(and(eq(schema.unitNurses.nurseId, auth.id), eq(schema.units.status, "active")))
    .orderBy(asc(schema.units.name));
  return c.json({ units: rows });
});

app.post("/units", requireRole("head_nurse"), async (c) => {
  const auth = c.get("auth");
  const db = dbOrThrow();
  const body = unitInput.parse(await c.req.json());
  const now = Date.now();
  try {
    const [unit] = await db
      .insert(schema.units)
      .values({
        id: `unit-${randomUUID()}`,
        name: body.name,
        description: body.description,
        status: "active",
        createdBy: auth.id,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    return c.json({ unit }, 201);
  } catch (error) {
    if (isUniqueViolation(error)) return c.json({ error: "A unit with that name already exists" }, 409);
    throw error;
  }
});

app.get("/units/:id", requireRole("head_nurse"), async (c) => {
  const db = dbOrThrow();
  const [unit] = await db.select().from(schema.units).where(eq(schema.units.id, c.req.param("id"))).limit(1);
  if (!unit) return c.json({ error: "Unit not found" }, 404);
  const nurses = await db
    .select({
      id: schema.users.id,
      username: schema.users.username,
      displayName: schema.users.displayName,
      participantCode: schema.users.participantCode,
    })
    .from(schema.unitNurses)
    .innerJoin(schema.users, eq(schema.users.id, schema.unitNurses.nurseId))
    .where(eq(schema.unitNurses.unitId, unit.id))
    .orderBy(asc(schema.users.displayName));
  return c.json({ unit, nurses });
});

app.patch("/units/:id", requireRole("head_nurse"), async (c) => {
  const db = dbOrThrow();
  const body = z
    .object({
      name: z.string().trim().min(1).max(80).optional(),
      description: z.string().trim().max(240).optional(),
      status: z.enum(["active", "inactive"]).optional(),
    })
    .strict()
    .refine((value) => Object.keys(value).length > 0, { message: "No unit changes supplied" })
    .parse(await c.req.json());
  try {
    const [unit] = await db
      .update(schema.units)
      .set({ ...body, updatedAt: Date.now() })
      .where(eq(schema.units.id, c.req.param("id")))
      .returning();
    if (!unit) return c.json({ error: "Unit not found" }, 404);
    return c.json({ unit });
  } catch (error) {
    if (isUniqueViolation(error)) return c.json({ error: "A unit with that name already exists" }, 409);
    throw error;
  }
});

app.delete("/units/:id", requireRole("head_nurse"), async (c) => {
  const db = dbOrThrow();
  const id = c.req.param("id");
  const [used] = await db.select({ id: schema.shifts.id }).from(schema.shifts).where(eq(schema.shifts.unitId, id)).limit(1);
  if (used) return c.json({ error: "This unit has shifts. Archive it instead." }, 409);
  const [deleted] = await db.delete(schema.units).where(eq(schema.units.id, id)).returning({ id: schema.units.id });
  if (!deleted) return c.json({ error: "Unit not found" }, 404);
  return c.json({ deleted: deleted.id });
});

app.get("/nurses", requireRole("head_nurse"), async (c) => {
  const db = dbOrThrow();
  const nurses = await db
    .select({
      id: schema.users.id,
      username: schema.users.username,
      displayName: schema.users.displayName,
      participantCode: schema.users.participantCode,
    })
    .from(schema.users)
    .where(eq(schema.users.role, "nurse"))
    .orderBy(asc(schema.users.displayName));
  return c.json({ nurses });
});

app.post("/units/:id/nurses", requireRole("head_nurse"), async (c) => {
  const auth = c.get("auth");
  const db = dbOrThrow();
  const unitId = c.req.param("id");
  const body = z.object({ nurseIds: z.array(z.string().min(1)).min(1).max(200) }).parse(await c.req.json());
  const [unit] = await db.select({ id: schema.units.id }).from(schema.units).where(eq(schema.units.id, unitId)).limit(1);
  if (!unit) return c.json({ error: "Unit not found" }, 404);
  const nurses = await db
    .select({ id: schema.users.id, role: schema.users.role })
    .from(schema.users)
    .where(inArray(schema.users.id, body.nurseIds));
  if (nurses.length !== new Set(body.nurseIds).size || nurses.some((nurse) => nurse.role !== "nurse")) {
    return c.json({ error: "One or more nurses are not valid" }, 400);
  }
  const now = Date.now();
  await db
    .insert(schema.unitNurses)
    .values(body.nurseIds.map((nurseId) => ({ unitId, nurseId, assignedBy: auth.id, assignedAt: now })))
    .onConflictDoNothing();
  return c.json({ assigned: body.nurseIds.length });
});

app.delete("/units/:id/nurses/:nurseId", requireRole("head_nurse"), async (c) => {
  const db = dbOrThrow();
  const unitId = c.req.param("id");
  const nurseId = c.req.param("nurseId");
  await db
    .delete(schema.unitNurses)
    .where(and(eq(schema.unitNurses.unitId, unitId), eq(schema.unitNurses.nurseId, nurseId)));
  return c.json({ removed: nurseId });
});

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
  const startUnitIds = [...new Set(starts.map((start) => start.payload.unitId).filter(Boolean))] as string[];
  if (startUnitIds.length) {
    const knownUnits = await db
      .select({ id: schema.units.id })
      .from(schema.units)
      .where(inArray(schema.units.id, startUnitIds));
    if (knownUnits.length !== startUnitIds.length) {
      return c.json({ error: "This shift refers to a unit that no longer exists" }, 400);
    }
  }
  for (const start of starts) {
    if (!knownShifts.has(start.shiftId)) {
      await db
        .insert(schema.shifts)
        .values({
          id: start.shiftId,
          userId: auth.id,
          unitId: start.payload.unitId ?? null,
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
      .select({
        id: schema.shifts.id,
        userId: schema.shifts.userId,
        type: schema.shifts.type,
        unitId: schema.shifts.unitId,
        unitName: schema.units.name,
        startedAt: schema.shifts.startedAt,
        endedAt: schema.shifts.endedAt,
        summary: schema.shifts.summary,
      })
      .from(schema.shifts)
      .leftJoin(schema.units, eq(schema.units.id, schema.shifts.unitId))
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
    const units = await db
      .select({
        id: schema.units.id,
        name: schema.units.name,
        description: schema.units.description,
        status: schema.units.status,
        createdAt: schema.units.createdAt,
        updatedAt: schema.units.updatedAt,
      })
      .from(schema.unitNurses)
      .innerJoin(schema.units, eq(schema.units.id, schema.unitNurses.unitId))
      .where(and(eq(schema.unitNurses.nurseId, auth.id), eq(schema.units.status, "active")))
      .orderBy(asc(schema.units.name));
    const nextCursor = events.length ? Math.max(...events.map((e) => e.serverSeq ?? 0)) : cursor;
    return c.json({
      cursor: nextCursor,
      templates,
      config: configRow?.value ?? null,
      units,
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
  const units = await db.select().from(schema.units).orderBy(asc(schema.units.name));
  return c.json({
    cursor,
    templates,
    config: configRow?.value ?? null,
    units,
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
  const auth = c.get("auth");
  const db = dbOrThrow();
  const nurseId = c.req.query("nurseId");
  const from = c.req.query("from");
  const to = c.req.query("to");
  const unitId = c.req.query("unitId");
  const kind = c.req.query("kind") ?? "nurse";
  if (kind === "head_nurse") await autoEndExpiredHeadShifts(db, auth.id);
  const conditions = [];
  if (kind === "head_nurse") {
    conditions.push(eq(schema.shifts.kind, "head_nurse"), eq(schema.shifts.userId, auth.id));
  } else {
    conditions.push(eq(schema.shifts.kind, "nurse"));
  }
  if (nurseId) conditions.push(eq(schema.shifts.userId, nurseId));
  if (from) conditions.push(gte(schema.shifts.startedAt, new Date(`${from}T00:00:00`).getTime()));
  if (to) conditions.push(lte(schema.shifts.startedAt, new Date(`${to}T23:59:59`).getTime()));
  if (unitId === "unassigned") conditions.push(isNull(schema.shifts.unitId));
  else if (unitId) conditions.push(eq(schema.shifts.unitId, unitId));
  const rows = await db
    .select({
      id: schema.shifts.id,
      userId: schema.shifts.userId,
      type: schema.shifts.type,
      kind: schema.shifts.kind,
      unitId: schema.shifts.unitId,
      unitName: schema.units.name,
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
    .leftJoin(schema.units, eq(schema.units.id, schema.shifts.unitId))
    .leftJoin(schema.shiftReviews, eq(schema.shiftReviews.shiftId, schema.shifts.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(schema.shifts.startedAt))
    .limit(200);
  return c.json({ shifts: rows });
});

app.get("/shifts/:id", requireRole("head_nurse"), async (c) => {
  const auth = c.get("auth");
  const db = dbOrThrow();
  const id = c.req.param("id");
  const [shift] = await db
    .select({
      id: schema.shifts.id,
      userId: schema.shifts.userId,
      type: schema.shifts.type,
      kind: schema.shifts.kind,
      unitId: schema.shifts.unitId,
      unitName: schema.units.name,
      startedAt: schema.shifts.startedAt,
      endedAt: schema.shifts.endedAt,
      summary: schema.shifts.summary,
      nurseName: schema.users.displayName,
      participantCode: schema.users.participantCode,
    })
    .from(schema.shifts)
    .innerJoin(schema.users, eq(schema.users.id, schema.shifts.userId))
    .leftJoin(schema.units, eq(schema.units.id, schema.shifts.unitId))
    .where(eq(schema.shifts.id, id))
    .limit(1);
  if (!shift) return c.json({ error: "Shift not found" }, 404);
  if (
    shift.kind === "head_nurse" &&
    shift.userId === auth.id &&
    !shift.endedAt &&
    Date.now() >= shift.startedAt + MAX_SHIFT_MS
  ) {
    const summary = await closeHeadShiftAt(
      db,
      shift,
      auth.id,
      shift.startedAt + MAX_SHIFT_MS,
      `Auto-ended: maximum shift length of ${MAX_SHIFT_HOURS} hours reached`,
    );
    shift.endedAt = summary.endedAt ?? shift.startedAt + MAX_SHIFT_MS;
    shift.summary = summary;
  }
  const eventRows = await db
    .select()
    .from(schema.events)
    .where(eq(schema.events.shiftId, id))
    .orderBy(asc(schema.events.clientTs), asc(schema.events.serverSeq));
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
  const beds = await db.select().from(schema.beds).where(eq(schema.beds.shiftId, id));
  const handovers = await db.select().from(schema.handoverReports).where(eq(schema.handoverReports.shiftId, id));
  const [review] = await db.select().from(schema.shiftReviews).where(eq(schema.shiftReviews.shiftId, id)).limit(1);
  return c.json({ shift, events, beds, handovers, review: review ?? null });
});

app.patch("/shifts/:shiftId/tasks/:taskId", async (c) => {
  const auth = c.get("auth");
  const db = dbOrThrow();
  const shiftId = c.req.param("shiftId");
  const taskId = c.req.param("taskId");
  const patch = taskEditedPayload.parse(await c.req.json());
  const [shift] = await db
    .select()
    .from(schema.shifts)
    .where(eq(schema.shifts.id, shiftId))
    .limit(1);
  if (!shift) return c.json({ error: "Shift not found" }, 404);

  // Any authenticated user can alter any unfinished task in any shift,
  // regardless of who created or owns it.
  const rows = await db
    .select()
    .from(schema.events)
    .where(eq(schema.events.shiftId, shiftId))
    .orderBy(asc(schema.events.serverSeq));
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

  let task;
  try {
    task = reduce(events).tasks[taskId];
  } catch {
    return c.json({ error: "This shift's event log could not be reduced" }, 409);
  }
  if (!task) return c.json({ error: "Task not found" }, 404);
  if (!isTaskEditable(task.status)) {
    return c.json({ error: "Completed or missed tasks cannot be altered" }, 409);
  }

  const nextFrom = patch.plannedFrom ?? task.plannedFrom;
  const nextTo = patch.plannedTo ?? task.plannedTo;
  if (nextTo < nextFrom) {
    return c.json({ error: "Task end time cannot be before its start time" }, 400);
  }

  const now = Date.now();
  const event: DomainEvent = {
    id: randomUUID(),
    shiftId,
    bedId: task.bedId,
    taskId,
    actorId: auth.id,
    type: "TASK_EDITED",
    clientTs: now,
    payload: patch,
  };

  let summary: ShiftSummary;
  try {
    summary = buildShiftSummary([...events, event]);
  } catch {
    return c.json({ error: "That task change is not valid" }, 400);
  }

  await db.insert(schema.events).values({
    id: event.id,
    shiftId,
    bedId: task.bedId,
    taskId,
    actorId: auth.id,
    type: event.type,
    payload: patch,
    clientTs: now,
    serverTs: now,
  });

  if (shift.endedAt) {
    await db
      .update(schema.shifts)
      .set({ summary })
      .where(eq(schema.shifts.id, shiftId));
  }

  return c.json({
    event: { ...event, serverTs: now },
    summary: shift.endedAt ? summary : null,
  });
});

/* ------------------------------------------------------------------ */
/* Head-nurse shifts and tasks                                         */
/* ------------------------------------------------------------------ */

app.post("/head-shifts", requireRole("head_nurse"), async (c) => {
  const auth = c.get("auth");
  const db = dbOrThrow();
  const body = z
    .object({
      unitId: z.string().min(1),
      type: z.enum(["day", "night", "custom"]),
      startedAt: z.number().int().optional(),
      backdateMin: z.number().int().min(0).max(720).optional(),
    })
    .parse(await c.req.json());
  const [unit] = await db.select().from(schema.units).where(eq(schema.units.id, body.unitId)).limit(1);
  if (!unit || unit.status !== "active") return c.json({ error: "Active unit not found" }, 404);
  await autoEndExpiredHeadShifts(db, auth.id);
  const [existing] = await db
    .select()
    .from(schema.shifts)
    .where(
      and(
        eq(schema.shifts.userId, auth.id),
        eq(schema.shifts.kind, "head_nurse"),
        isNull(schema.shifts.endedAt),
      ),
    )
    .limit(1);
  if (existing) return c.json({ error: "A head-nurse shift is already active", shiftId: existing.id }, 409);
  const now = Date.now();
  const startedAt = body.startedAt ?? now - (body.backdateMin ?? 0) * 60_000;
  if (startedAt > now + 5 * 60_000) return c.json({ error: "Shift start cannot be in the future" }, 400);
  const shiftId = randomUUID();
  const shift = {
    id: shiftId,
    userId: auth.id,
    unitId: unit.id,
    type: body.type,
    kind: "head_nurse" as const,
    startedAt,
    endedAt: null,
    summary: null,
  };
  const templates = await db
    .select()
    .from(schema.taskTemplates)
    .where(
      and(
        eq(schema.taskTemplates.role, "head_nurse"),
        eq(schema.taskTemplates.scope, "shift"),
        eq(schema.taskTemplates.active, true),
      ),
    )
    .orderBy(asc(schema.taskTemplates.offsetMin));
  const events: DomainEvent[] = [
    {
      id: randomUUID(),
      shiftId,
      actorId: auth.id,
      type: "SHIFT_STARTED",
      clientTs: startedAt,
      payload: { shiftType: body.type, kind: "head_nurse", unitId: unit.id, unitName: unit.name },
    },
    ...templates.map((template) => {
      const plannedFrom = startedAt + template.offsetMin * 60_000;
      return {
        id: randomUUID(),
        shiftId,
        taskId: randomUUID(),
        actorId: auth.id,
        type: "TASK_CREATED" as const,
        clientTs: startedAt,
        payload: {
          title: template.name,
          category: template.category as "direct_care" | "indirect_care",
          tier: template.tier as 1 | 2 | 3 | 4,
          plannedFrom,
          plannedTo: plannedFrom + template.expectedMin * 60_000,
          expectedMin: template.expectedMin,
          intervalMin: template.intervalMin || undefined,
          unitId: unit.id,
          templateId: template.id,
          scope: "shift" as const,
        },
      };
    }),
  ];
  await db.insert(schema.shifts).values(shift);
  await db.insert(schema.events).values(
    events.map((event) => ({
      id: event.id,
      shiftId: event.shiftId,
      bedId: null,
      taskId: event.taskId ?? null,
      actorId: event.actorId,
      type: event.type,
      payload: event.payload,
      clientTs: event.clientTs,
      serverTs: now,
    })),
  );
  return c.json({ shift, events });
});

app.post("/head-shifts/:id/end", requireRole("head_nurse"), async (c) => {
  const auth = c.get("auth");
  const db = dbOrThrow();
  const id = c.req.param("id");
  const [shift] = await db.select().from(schema.shifts).where(eq(schema.shifts.id, id)).limit(1);
  if (!shift) return c.json({ error: "Shift not found" }, 404);
  if (shift.userId !== auth.id || shift.kind !== "head_nurse") {
    return c.json({ error: "Not your head-nurse shift" }, 403);
  }
  if (shift.endedAt) return c.json({ error: "Shift already ended" }, 409);
  const note = z.object({ note: z.string().max(1000).optional() }).parse(await c.req.json().catch(() => ({})));
  const summary = await closeHeadShiftAt(db, shift, auth.id, Date.now(), note.note ?? "");
  return c.json({ summary });
});

app.post("/head-shifts/:id/tasks", requireRole("head_nurse"), async (c) => {
  const auth = c.get("auth");
  const db = dbOrThrow();
  const id = c.req.param("id");
  const [shift] = await db.select().from(schema.shifts).where(eq(schema.shifts.id, id)).limit(1);
  if (!shift) return c.json({ error: "Shift not found" }, 404);
  if (shift.userId !== auth.id || shift.kind !== "head_nurse") {
    return c.json({ error: "Not your head-nurse shift" }, 403);
  }
  if (shift.endedAt) return c.json({ error: "Shift is already ended" }, 409);
  const body = z
    .object({
      title: z.string().trim().min(1).max(120),
      category: z.enum(["direct_care", "indirect_care"]),
      tier: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
      plannedFrom: z.number().int(),
      plannedTo: z.number().int(),
      expectedMin: z.number().int().min(0).max(720).optional(),
      note: z.string().max(300).optional(),
    })
    .parse(await c.req.json());
  if (body.plannedTo < body.plannedFrom) return c.json({ error: "Task end cannot be before its start" }, 400);
  if (body.plannedFrom < Date.now() - 5 * 60_000) return c.json({ error: "To Do tasks must be planned for the future" }, 400);
  const now = Date.now();
  const event: DomainEvent = {
    id: randomUUID(),
    shiftId: id,
    taskId: randomUUID(),
    actorId: auth.id,
    type: "TASK_CREATED",
    clientTs: now,
    payload: {
      title: body.title,
      category: body.category,
      tier: body.tier,
      plannedFrom: body.plannedFrom,
      plannedTo: body.plannedTo,
      expectedMin: body.expectedMin ?? Math.round((body.plannedTo - body.plannedFrom) / 60_000),
      unitId: shift.unitId ?? undefined,
      scope: "shift",
      note: body.note,
    },
  };
  await db.insert(schema.events).values({
    id: event.id,
    shiftId: id,
    bedId: null,
    taskId: event.taskId ?? null,
    actorId: auth.id,
    type: event.type,
    payload: event.payload,
    clientTs: now,
    serverTs: now,
  });
  return c.json({ event: { ...event, serverTs: now } });
});

app.post("/head-shifts/:id/tasks/:taskId/complete", requireRole("head_nurse"), async (c) => {
  const auth = c.get("auth");
  const db = dbOrThrow();
  const id = c.req.param("id");
  const taskId = c.req.param("taskId");
  const [shift] = await db.select().from(schema.shifts).where(eq(schema.shifts.id, id)).limit(1);
  if (!shift) return c.json({ error: "Shift not found" }, 404);
  if (shift.userId !== auth.id || shift.kind !== "head_nurse") {
    return c.json({ error: "Not your head-nurse shift" }, 403);
  }
  const events = await loadShiftEvents(db, id);
  const task = reduce(events).tasks[taskId];
  if (!task) return c.json({ error: "Task not found" }, 404);
  if (!isTaskEditable(task.status)) return c.json({ error: "Completed or missed tasks cannot be altered" }, 409);
  const now = Date.now();
  const event: DomainEvent = {
    id: randomUUID(),
    shiftId: id,
    bedId: task.bedId,
    taskId,
    actorId: auth.id,
    type: "TASK_COMPLETED",
    clientTs: now,
    payload: { tickOnly: true },
  };
  const next = nextRecurringTask(task, now, auth.id);
  const newEvents = next ? [event, next] : [event];
  await db.insert(schema.events).values(
    newEvents.map((item) => ({
      id: item.id,
      shiftId: id,
      bedId: item.bedId ?? null,
      taskId: item.taskId ?? null,
      actorId: auth.id,
      type: item.type,
      payload: item.payload,
      clientTs: now,
      serverTs: now,
    })),
  );
  return c.json({ event: { ...event, serverTs: now } });
});

app.post("/head-shifts/:id/tasks/:taskId/time-log", requireRole("head_nurse"), async (c) => {
  const auth = c.get("auth");
  const db = dbOrThrow();
  const id = c.req.param("id");
  const taskId = c.req.param("taskId");
  const body = taskTimeLoggedPayload.parse(await c.req.json());
  const [shift] = await db.select().from(schema.shifts).where(eq(schema.shifts.id, id)).limit(1);
  if (!shift) return c.json({ error: "Shift not found" }, 404);
  if (shift.userId !== auth.id || shift.kind !== "head_nurse") {
    return c.json({ error: "Not your head-nurse shift" }, 403);
  }
  const events = await loadShiftEvents(db, id);
  const task = reduce(events).tasks[taskId];
  if (!task) return c.json({ error: "Task not found" }, 404);
  if (task.status === "missed") return c.json({ error: "Missed tasks cannot receive a time log" }, 409);
  if (task.durationRecorded) return c.json({ error: "This task already has a recorded duration" }, 409);
  if (task.status === "in_progress" || task.status === "paused") {
    return c.json({ error: "Finish the live timer before logging a past interval" }, 409);
  }
  if (body.endedAt > Date.now() + 5 * 60_000) return c.json({ error: "Time log cannot end in the future" }, 400);
  const now = Date.now();
  const event: DomainEvent = {
    id: randomUUID(),
    shiftId: id,
    bedId: task.bedId,
    taskId,
    actorId: auth.id,
    type: "TASK_TIME_LOGGED",
    clientTs: now,
    payload: body,
  };
  const next = task.status === "done" ? null : nextRecurringTask(task, body.endedAt, auth.id);
  const newEvents = next ? [event, next] : [event];
  await db.insert(schema.events).values(
    newEvents.map((item) => ({
      id: item.id,
      shiftId: id,
      bedId: item.bedId ?? null,
      taskId: item.taskId ?? null,
      actorId: auth.id,
      type: item.type,
      payload: item.payload,
      clientTs: now,
      serverTs: now,
    })),
  );
  return c.json({ event: { ...event, serverTs: now } });
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
  const unitId = c.req.query("unitId");
  const conditions = [eq(schema.shifts.kind, "nurse"), gte(schema.shifts.startedAt, since)];
  if (unitId === "unassigned") conditions.push(isNull(schema.shifts.unitId));
  else if (unitId) conditions.push(eq(schema.shifts.unitId, unitId));
  const rows = await db
    .select({ summary: schema.shifts.summary, startedAt: schema.shifts.startedAt, endedAt: schema.shifts.endedAt })
    .from(schema.shifts)
    .where(and(...conditions));
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
  const unitId = c.req.query("unitId");
  const unitCondition =
    unitId === "unassigned"
      ? isNull(schema.shifts.unitId)
      : unitId
        ? eq(schema.shifts.unitId, unitId)
        : undefined;
  const exportConditions = unitCondition
    ? and(eq(schema.shifts.kind, "nurse"), unitCondition)
    : eq(schema.shifts.kind, "nurse");
  let header: string[] = [];
  let rows: (string | number | boolean | null | undefined)[][] = [];
  if (type === "events") {
    const data = await db
      .select({
        id: schema.events.id,
        shiftId: schema.events.shiftId,
        bedId: schema.events.bedId,
        taskId: schema.events.taskId,
        actorId: schema.events.actorId,
        type: schema.events.type,
        clientTs: schema.events.clientTs,
        serverTs: schema.events.serverTs,
        payload: schema.events.payload,
        unitId: schema.shifts.unitId,
        unitName: schema.units.name,
      })
      .from(schema.events)
      .innerJoin(schema.shifts, eq(schema.shifts.id, schema.events.shiftId))
      .leftJoin(schema.units, eq(schema.units.id, schema.shifts.unitId))
      .where(exportConditions)
      .orderBy(asc(schema.events.serverSeq));
    header = ["id", "shift_id", "unit_id", "unit_name", "bed_id", "task_id", "actor_id", "type", "client_ts", "server_ts", "payload"];
    rows = data.map((r) => [r.id, r.shiftId, r.unitId, r.unitName, r.bedId, r.taskId, r.actorId, r.type, r.clientTs, r.serverTs, JSON.stringify(r.payload)]);
  } else if (type === "summaries") {
    const data = await db
      .select({ id: schema.shifts.id, userId: schema.shifts.userId, type: schema.shifts.type, unitId: schema.shifts.unitId, unitName: schema.units.name, startedAt: schema.shifts.startedAt, endedAt: schema.shifts.endedAt, summary: schema.shifts.summary })
      .from(schema.shifts)
      .leftJoin(schema.units, eq(schema.units.id, schema.shifts.unitId))
      .where(exportConditions)
      .orderBy(desc(schema.shifts.startedAt));
    header = ["shift_id", "nurse_id", "unit_id", "unit_name", "shift_type", "started_at", "ended_at", "direct_care_min", "indirect_care_min", "interruption_min", "emergency_min", "completion_rate", "tier12_on_time_rate", "missed", "deferred"];
    rows = data.map((r) => {
      const s = r.summary as ShiftSummary | null;
      return [r.id, r.userId, r.unitId, r.unitName, r.type, r.startedAt, r.endedAt, s?.directCareMin, s?.indirectCareMin, s?.interruptionMin, s?.emergencyMin, s?.completionRate, s?.tier12OnTimeRate, s?.missedCount, s?.deferredCount];
    });
  } else if (type === "surveys") {
    const data = await db.select().from(schema.surveyResponses).orderBy(desc(schema.surveyResponses.takenAt));
    header = ["id", "participant_code", "instrument", "phase", "score", "taken_at", "answers"];
    rows = data.map((r) => [r.id, r.participantCode, r.instrument, r.phase, r.score, r.takenAt, JSON.stringify(r.answers)]);
  } else if (type === "reviews") {
    const data = await db
      .select({
        id: schema.shiftReviews.id,
        shiftId: schema.shiftReviews.shiftId,
        nurseId: schema.shiftReviews.nurseId,
        reviewerId: schema.shiftReviews.reviewerId,
        scores: schema.shiftReviews.scores,
        comment: schema.shiftReviews.comment,
        needsSupport: schema.shiftReviews.needsSupport,
        createdAt: schema.shiftReviews.createdAt,
        unitId: schema.shifts.unitId,
        unitName: schema.units.name,
      })
      .from(schema.shiftReviews)
      .innerJoin(schema.shifts, eq(schema.shifts.id, schema.shiftReviews.shiftId))
      .leftJoin(schema.units, eq(schema.units.id, schema.shifts.unitId))
      .where(exportConditions)
      .orderBy(desc(schema.shiftReviews.createdAt));
    header = ["id", "shift_id", "unit_id", "unit_name", "nurse_id", "reviewer_id", "scores", "comment", "needs_support", "created_at"];
    rows = data.map((r) => [r.id, r.shiftId, r.unitId, r.unitName, r.nurseId, r.reviewerId, JSON.stringify(r.scores), r.comment, r.needsSupport, r.createdAt]);
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
      "Content-Disposition": `attachment; filename="tasklog-${type}.csv"`,
    },
  });
});

export { app };
export type { AppEnv };
