import "dotenv/config";
import bcrypt from "bcryptjs";
import { Pool } from "pg";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { reduce, type DomainEvent } from "../src/domain";
import { DEMO_TEMPLATES } from "../src/lib/demo-data";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required for the disposable API test database");
const parsed = new URL(url);
if (!["localhost", "127.0.0.1", "db"].includes(parsed.hostname)) {
  throw new Error("Refusing to run destructive API tests against a non-local database host");
}

const pool = new Pool({ connectionString: url });
let failures = 0;
function check(name: string, condition: unknown, detail?: unknown) {
  if (condition) {
    console.log(`PASS ${name}`);
  } else {
    failures += 1;
    console.error(`FAIL ${name}`, detail ?? "");
  }
}

async function req(path: string, init: RequestInit = {}) {
  const { app } = await import("../src/server/app");
  return app.request(`http://localhost${path}`, init);
}

async function json<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

async function main() {
  const schemaSql = readFileSync(resolve("scripts/schema.sql"), "utf8");
  await pool.query(schemaSql);
  await pool.query(`
    TRUNCATE survey_responses, shift_reviews, handover_reports, events, beds, shifts, unit_nurses, units, task_templates, config, users CASCADE
  `);

  for (const user of [
    { id: "u-nurse-1", username: "amina", pin: "1111", role: "nurse", name: "Amina Hassan", code: "N01" },
    { id: "u-head-1", username: "head", pin: "9999", role: "head_nurse", name: "Layla Mansour, RN", code: "H01" },
  ]) {
    await pool.query(
      "INSERT INTO users (id, username, pin_hash, role, display_name, participant_code) VALUES ($1,$2,$3,$4,$5,$6)",
      [user.id, user.username, await bcrypt.hash(user.pin, 4), user.role, user.name, user.code],
    );
  }
  for (const template of DEMO_TEMPLATES) {
    await pool.query(
      "INSERT INTO task_templates (id, name, category, tier, interval_min, expected_min, offset_min, active, role, scope) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
      [template.id, template.name, template.category, template.tier, template.intervalMin, template.expectedMin, template.offsetMin, template.active, template.role, template.scope],
    );
  }
  await pool.query(
    "INSERT INTO config (key, value) VALUES ('app', $1)",
    [JSON.stringify({ missedTimeoutMin: 30, alertLeadMin: 10, idleLockSec: 60, rescheduleOffsetMode: "emergency_duration", fixedOffsetMin: 0 })],
  );

  const health = await req("/api/health");
  const healthBody = await json<{ ok: boolean; database: boolean }>(health);
  check("health returns 200", health.status === 200, health.status);
  check("health reports database", healthBody.ok && healthBody.database, healthBody);

  const newAccount = {
    username: "api-new-nurse",
    displayName: "API Test Nurse",
    pin: "2468",
  };
  const weakRegister = await req("/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...newAccount, pin: "12" }),
  });
  check("registration rejects a weak PIN", weakRegister.status === 400, weakRegister.status);

  const roleRegister = await req("/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...newAccount, role: "head_nurse" }),
  });
  check("registration rejects a client-supplied role", roleRegister.status === 400, roleRegister.status);

  const register = await req("/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(newAccount),
  });
  const created = await json<{
    token: string;
    user: { id: string; role: string; participantCode: string; displayName: string };
  }>(register);
  check(
    "nurse registration returns a nurse token",
    register.status === 201 &&
      created.token.length > 20 &&
      created.user.role === "nurse" &&
      created.user.participantCode.startsWith("N-") &&
      created.user.displayName === newAccount.displayName,
    { status: register.status, user: created.user },
  );

  const stored = await pool.query<{ pin_hash: string; role: string }>(
    "SELECT pin_hash, role FROM users WHERE username = $1",
    [newAccount.username],
  );
  check(
    "new account stores a hashed PIN",
    stored.rows[0]?.pin_hash !== newAccount.pin &&
      stored.rows[0]?.pin_hash.startsWith("$2") &&
      stored.rows[0]?.role === "nurse",
    stored.rows[0]?.role,
  );

  const duplicateRegister = await req("/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(newAccount),
  });
  check("duplicate username is rejected", duplicateRegister.status === 409, duplicateRegister.status);

  const newLogin = await req("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: newAccount.username, pin: newAccount.pin }),
  });
  const newSession = await json<{ token: string; user: { role: string } }>(newLogin);
  check(
    "new account can sign in",
    newLogin.status === 200 && newSession.user.role === "nurse" && newSession.token.length > 20,
    newLogin.status,
  );

  const newMe = await req("/api/me", {
    headers: { Authorization: `Bearer ${newSession.token}` },
  });
  const newMeBody = await json<{ user: { role: string; username: string } }>(newMe);
  check(
    "new account token resolves to the nurse",
    newMe.status === 200 &&
      newMeBody.user.role === "nurse" &&
      newMeBody.user.username === newAccount.username,
    newMe.status,
  );

  const badLogin = await req("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "amina", pin: "badpin" }),
  });
  check("wrong PIN is rejected", badLogin.status === 401, badLogin.status);

  const login = await req("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "amina", pin: "1111" }),
  });
  const nurse = await json<{ token: string; user: { id: string } }>(login);
  check("nurse login returns a token", login.status === 200 && nurse.token.length > 20, login.status);

  const headLogin = await req("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "head", pin: "9999" }),
  });
  const head = await json<{ token: string; user: { id: string } }>(headLogin);
  check("head login returns a token", headLogin.status === 200 && head.token.length > 20, headLogin.status);

  const createUnit = await req("/api/units", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${head.token}` },
    body: JSON.stringify({ name: "API Unit", description: "Disposable test unit" }),
  });
  const createdUnit = await json<{ unit: { id: string; name: string } }>(createUnit);
  check("head creates a unit", createUnit.status === 201 && createdUnit.unit.name === "API Unit", createUnit.status);
  const unitId = createdUnit.unit.id;

  const duplicateUnit = await req("/api/units", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${head.token}` },
    body: JSON.stringify({ name: "API Unit" }),
  });
  check("duplicate unit name is rejected", duplicateUnit.status === 409, duplicateUnit.status);

  const nurseCreateUnit = await req("/api/units", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${nurse.token}` },
    body: JSON.stringify({ name: "Nurse Unit" }),
  });
  check("nurse cannot create a unit", nurseCreateUnit.status === 403, nurseCreateUnit.status);

  const assign = await req(`/api/units/${unitId}/nurses`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${head.token}` },
    body: JSON.stringify({ nurseIds: [nurse.user.id] }),
  });
  check("head assigns a nurse to a unit", assign.status === 200, assign.status);

  const nurseUnits = await req("/api/units", { headers: { Authorization: `Bearer ${nurse.token}` } });
  const nurseUnitsBody = await json<{ units: { id: string; name: string }[] }>(nurseUnits);
  check(
    "nurse sees the assigned active unit",
    nurseUnits.status === 200 && nurseUnitsBody.units.some((unit) => unit.id === unitId),
    nurseUnitsBody,
  );

  const unauthPush = await req("/api/sync/push", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ events: [] }),
  });
  check("sync requires a bearer token", unauthPush.status === 401, unauthPush.status);

  const now = Date.now();
  const start = now - 3 * 3_600_000;
  const base = { shiftId: "api-test-shift", actorId: nurse.user.id };
  const events: DomainEvent[] = [
    {
      ...base,
      id: "api-test-e1",
      type: "SHIFT_STARTED",
      payload: { shiftType: "day", kind: "nurse", unitId, unitName: "API Unit", bedLabels: ["Bed 1"] },
      clientTs: start,
    },
    {
      ...base,
      id: "api-test-e2",
      type: "TASK_CREATED",
      bedId: "api-bed-1",
      taskId: "api-task-1",
      payload: {
        title: "Vital signs",
        category: "direct_care",
        tier: 2,
        plannedFrom: start + 5 * 60_000,
        plannedTo: start + 15 * 60_000,
        expectedMin: 10,
        unitId,
        bedLabel: "Bed 1",
      },
      clientTs: start + 60_000,
    },
    {
      ...base,
      id: "api-test-e3",
      type: "TASK_STARTED",
      bedId: "api-bed-1",
      taskId: "api-task-1",
      payload: {},
      clientTs: start + 2 * 60_000,
    },
    {
      ...base,
      id: "api-test-e4",
      type: "TASK_COMPLETED",
      bedId: "api-bed-1",
      taskId: "api-task-1",
      payload: {},
      clientTs: start + 12 * 60_000,
    },
    {
      ...base,
      id: "api-test-e5",
      type: "SHIFT_ENDED",
      payload: { note: "API test shift" },
      clientTs: start + 60 * 60_000,
    },
  ];

  const push = await req("/api/sync/push", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${nurse.token}` },
    body: JSON.stringify({ events }),
  });
  const pushed = await json<{ inserted: number; duplicates: number }>(push);
  check("push accepts a valid shift", push.status === 200 && pushed.inserted === 5, pushed);

  const duplicate = await req("/api/sync/push", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${nurse.token}` },
    body: JSON.stringify({ events: [events[0]] }),
  });
  const duplicateBody = await json<{ inserted: number; duplicates: number }>(duplicate);
  check("push is idempotent", duplicate.status === 200 && duplicateBody.inserted === 0 && duplicateBody.duplicates === 1, duplicateBody);

  const pull = await req("/api/sync/pull?cursor=0", {
    headers: { Authorization: `Bearer ${nurse.token}` },
  });
  const pulled = await json<{ events: DomainEvent[]; shifts: { summary?: { tasksTotal: number; tasksDone: number; directCareMin: number } }[]; templates: unknown[] }>(pull);
  check("pull returns the stored events", pull.status === 200 && pulled.events.length === 5, pulled.events.length);
  check("pull returns templates", pulled.templates.length === DEMO_TEMPLATES.length, pulled.templates.length);
  check(
    "shift summary is recomputed server-side",
    pulled.shifts[0]?.summary?.tasksTotal === 1 && pulled.shifts[0]?.summary?.tasksDone === 1 && pulled.shifts[0]?.summary?.directCareMin === 10,
    pulled.shifts[0]?.summary,
  );

  const shifts = await req("/api/shifts", { headers: { Authorization: `Bearer ${head.token}` } });
  const shiftList = await json<{ shifts: { id: string; nurseName: string; unitId: string | null; unitName: string | null; reviewId: string | null }[] }>(shifts);
  check("head can list shifts", shifts.status === 200 && shiftList.shifts.length === 1 && shiftList.shifts[0].nurseName === "Amina Hassan", shiftList);
  check("head shift list includes the unit", shiftList.shifts[0]?.unitId === unitId && shiftList.shifts[0]?.unitName === "API Unit", shiftList.shifts[0]);

  const unitShifts = await req(`/api/shifts?unitId=${encodeURIComponent(unitId)}`, { headers: { Authorization: `Bearer ${head.token}` } });
  const unitShiftList = await json<{ shifts: { id: string }[] }>(unitShifts);
  check("head can filter shifts by unit", unitShifts.status === 200 && unitShiftList.shifts.length === 1, unitShiftList);

  const unassignedShifts = await req("/api/shifts?unitId=unassigned", { headers: { Authorization: `Bearer ${head.token}` } });
  const unassignedList = await json<{ shifts: { id: string }[] }>(unassignedShifts);
  check("unassigned filter is empty for this unit shift", unassignedShifts.status === 200 && unassignedList.shifts.length === 0, unassignedList);

  const detail = await req("/api/shifts/api-test-shift", { headers: { Authorization: `Bearer ${head.token}` } });
  const detailBody = await json<{ events: { bedId?: string | null; taskId?: string | null }[]; review: unknown }>(detail);
  check("head can open shift detail", detail.status === 200 && detailBody.events.length === 5 && detailBody.review === null, detail.status);
  check(
    "shift detail normalizes nullable event ids for reduction",
    detailBody.events.every((event) => event.bedId !== null && event.taskId !== null),
    detailBody.events,
  );

  const analytics = await req("/api/analytics/unit?days=30", { headers: { Authorization: `Bearer ${head.token}` } });
  const analyticsBody = await json<{ shifts: number; avgCompletionRate: number }>(analytics);
  check("analytics includes the finished shift", analytics.status === 200 && analyticsBody.shifts === 1 && analyticsBody.avgCompletionRate === 1, analyticsBody);

  const unitAnalytics = await req(`/api/analytics/unit?days=30&unitId=${encodeURIComponent(unitId)}`, {
    headers: { Authorization: `Bearer ${head.token}` },
  });
  const unitAnalyticsBody = await json<{ shifts: number }>(unitAnalytics);
  check("analytics can filter by unit", unitAnalytics.status === 200 && unitAnalyticsBody.shifts === 1, unitAnalyticsBody);

  const review = await req("/api/reviews", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${head.token}` },
    body: JSON.stringify({
      id: "api-test-review",
      shiftId: "api-test-shift",
      scores: { completion: 5, critical_timeliness: 4, interruption_handling: 4, handover_quality: 5, documentation: 4 },
      comment: "API test review",
      needsSupport: false,
      createdAt: now,
    }),
  });
  check("head can submit a manual review", review.status === 200, review.status);

  const mine = await req("/api/reviews/mine", { headers: { Authorization: `Bearer ${nurse.token}` } });
  const mineBody = await json<{ reviews: { comment: string }[] }>(mine);
  check("nurse can read own review", mine.status === 200 && mineBody.reviews[0]?.comment === "API test review", mineBody);

  const survey = await req("/api/surveys", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${nurse.token}` },
    body: JSON.stringify({ id: "api-test-survey", instrument: "SUS", phase: "app", answers: [5, 1, 5, 1, 5, 1, 5, 1, 5, 1], takenAt: now }),
  });
  const surveyBody = await json<{ score: number }>(survey);
  check("SUS is scored server-side", survey.status === 200 && surveyBody.score === 100, surveyBody);

  const csv = await req("/api/export?type=summaries", { headers: { Authorization: `Bearer ${head.token}` } });
  const text = await csv.text();
  check(
    "CSV export has unit columns and the shift row",
    csv.status === 200 && text.includes("unit_id") && text.includes("unit_name") && text.includes("api-test-shift") && text.includes("API Unit"),
    text.slice(0, 300),
  );

  const filteredCsv = await req(`/api/export?type=summaries&unitId=${encodeURIComponent(unitId)}`, {
    headers: { Authorization: `Bearer ${head.token}` },
  });
  const filteredText = await filteredCsv.text();
  check("CSV export can filter by unit", filteredCsv.status === 200 && filteredText.includes("API Unit"), filteredText.slice(0, 200));

  const headForbidden = await req("/api/analytics/unit", { headers: { Authorization: `Bearer ${nurse.token}` } });
  check("nurse cannot use head analytics", headForbidden.status === 403, headForbidden.status);

  const editStart = now - 2 * 3_600_000;
  const editShiftId = "api-edit-shift";
  const editTaskId = "api-edit-task";
  const editEvents: DomainEvent[] = [
    {
      ...base,
      shiftId: editShiftId,
      id: "api-edit-e1",
      type: "SHIFT_STARTED",
      payload: { shiftType: "day", kind: "nurse", unitId, unitName: "API Unit", bedLabels: ["Bed 1"] },
      clientTs: editStart,
    },
    {
      ...base,
      shiftId: editShiftId,
      id: "api-edit-e2",
      type: "TASK_CREATED",
      bedId: "api-edit-bed-1",
      taskId: editTaskId,
      payload: {
        title: "Original task",
        category: "direct_care",
        tier: 2,
        plannedFrom: editStart + 5 * 60_000,
        plannedTo: editStart + 15 * 60_000,
        expectedMin: 10,
        unitId,
        bedLabel: "Bed 1",
      },
      clientTs: editStart + 60_000,
    },
  ];
  const editPush = await req("/api/sync/push", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${nurse.token}` },
    body: JSON.stringify({ events: editEvents }),
  });
  check("push accepts an editable shift", editPush.status === 200, editPush.status);

  const nursePatch = await req(`/api/shifts/${editShiftId}/tasks/${editTaskId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${nurse.token}` },
    body: JSON.stringify({ title: "Nurse-edited task", note: "Nurse note on an unfinished task" }),
  });
  check("nurse can alter own unfinished task", nursePatch.status === 200, nursePatch.status);

  const headPatch = await req(`/api/shifts/${editShiftId}/tasks/${editTaskId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${head.token}` },
    body: JSON.stringify({
      tier: 3,
      plannedFrom: editStart + 20 * 60_000,
      plannedTo: editStart + 35 * 60_000,
      note: "Head-nurse note on an unfinished task",
    }),
  });
  check("head can alter an unfinished task", headPatch.status === 200, headPatch.status);

  // Cross-nurse: a different nurse can alter a task in another nurse's shift
  const otherNursePatch = await req(`/api/shifts/${editShiftId}/tasks/${editTaskId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${newSession.token}`,
    },
    body: JSON.stringify({ note: "Edited by a different nurse" }),
  });
  check(
    "nurse can alter another nurse's unfinished task",
    otherNursePatch.status === 200,
    otherNursePatch.status,
  );

  const finishedPatch = await req(`/api/shifts/api-test-shift/tasks/api-task-1`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${head.token}` },
    body: JSON.stringify({ note: "Too late" }),
  });
  check("finished tasks reject edits", finishedPatch.status === 409, finishedPatch.status);

  // Remove an unfinished task
  const removeTaskId = "api-remove-task";
  const removeShiftId = "api-remove-shift";
  const removeStart = now - 3_600_000;
  const removeEvents: DomainEvent[] = [
    {
      ...base,
      shiftId: removeShiftId,
      id: "api-remove-e1",
      type: "SHIFT_STARTED",
      payload: { shiftType: "day", kind: "nurse", unitId, unitName: "API Unit", bedLabels: ["Bed 1"] },
      clientTs: removeStart,
    },
    {
      ...base,
      shiftId: removeShiftId,
      id: "api-remove-e2",
      type: "TASK_CREATED",
      taskId: removeTaskId,
      payload: {
        title: "Task to remove",
        category: "direct_care",
        tier: 3,
        plannedFrom: removeStart + 5 * 60_000,
        plannedTo: removeStart + 15 * 60_000,
        expectedMin: 10,
        unitId,
        scope: "shift",
      },
      clientTs: removeStart + 60_000,
    },
  ];
  const removePush = await req("/api/sync/push", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${nurse.token}` },
    body: JSON.stringify({ events: removeEvents }),
  });
  check("push accepts a removable shift", removePush.status === 200, removePush.status);

  const removeResponse = await req(`/api/shifts/${removeShiftId}/tasks/${removeTaskId}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${nurse.token}` },
    body: JSON.stringify({ reason: "No longer needed" }),
  });
  check("nurse can remove an unfinished task", removeResponse.status === 200, removeResponse.status);

  // Try to remove the same task again (now removed)
  const removeAgain = await req(`/api/shifts/${removeShiftId}/tasks/${removeTaskId}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${nurse.token}` },
    body: JSON.stringify({ reason: "Again" }),
  });
  check("removed task cannot be removed again", removeAgain.status === 409, removeAgain.status);

  // Another nurse can remove a task in this shift
  const otherRemove = await req(`/api/shifts/${removeShiftId}/tasks/${removeTaskId}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${newSession.token}` },
    body: JSON.stringify({ reason: "Cross-nurse remove" }),
  });
  check(
    "another nurse cannot remove an already-removed task",
    otherRemove.status === 409,
    otherRemove.status,
  );

  const editPull = await req("/api/sync/pull?cursor=0", {
    headers: { Authorization: `Bearer ${nurse.token}` },
  });
  const editPullBody = await json<{ events: DomainEvent[] }>(editPull);
  const editEventsPulled = editPullBody.events.filter(
    (event) => event.type === "TASK_EDITED" && event.taskId === editTaskId,
  );
  check(
    "nurse pull includes edits made by multiple roles",
    editPull.status === 200 && editEventsPulled.length === 3,
    editEventsPulled.length,
  );


  const headShiftStart = await req("/api/head-shifts", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${head.token}` },
    body: JSON.stringify({ unitId, type: "day" }),
  });
  const headShiftBody = await json<{ shift: { id: string; kind: string }; events: DomainEvent[] }>(headShiftStart);
  check(
    "head starts a head-nurse shift with 14 tasks",
    headShiftStart.status === 200 && headShiftBody.shift.kind === "head_nurse" && headShiftBody.events.length === 15,
    { status: headShiftStart.status, events: headShiftBody.events.length },
  );
  const headShiftId = headShiftBody.shift.id;

  const headList = await req(`/api/shifts?kind=head_nurse&nurseId=${encodeURIComponent(head.user.id)}`, {
    headers: { Authorization: `Bearer ${head.token}` },
  });
  const headListBody = await json<{ shifts: { id: string; kind: string }[] }>(headList);
  check(
    "head shift list contains only the head-nurse shift",
    headList.status === 200 && headListBody.shifts.length === 1 && headListBody.shifts[0]?.id === headShiftId,
    headListBody,
  );

  const nurseList = await req("/api/shifts?kind=nurse", { headers: { Authorization: `Bearer ${head.token}` } });
  const nurseListBody = await json<{ shifts: { id: string; kind: string }[] }>(nurseList);
  check(
    "nurse shift list excludes head-nurse shifts",
    nurseList.status === 200 && nurseListBody.shifts.every((shift) => shift.kind === "nurse" && shift.id !== headShiftId),
    nurseListBody,
  );

  const headDetail = await req(`/api/shifts/${headShiftId}`, { headers: { Authorization: `Bearer ${head.token}` } });
  const headDetailBody = await json<{ events: DomainEvent[] }>(headDetail);
  const headState = reduce(headDetailBody.events);
  const headTasks = Object.values(headState.tasks);
  check(
    "head shift detail reduces to 14 shift tasks",
    headDetail.status === 200 && headTasks.length === 14 && headTasks.every((task) => task.scope === "shift" && !task.bedId),
    { status: headDetail.status, tasks: headTasks.length },
  );

  const manualHeadTask = await req(`/api/head-shifts/${headShiftId}/tasks`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${head.token}` },
    body: JSON.stringify({
      title: "API head-nurse planning task",
      category: "indirect_care",
      tier: 3,
      plannedFrom: now + 10 * 60_000,
      plannedTo: now + 40 * 60_000,
      expectedMin: 30,
      note: "Future To Do task",
    }),
  });
  const manualHeadBody = await json<{ event: DomainEvent & { taskId?: string } }>(manualHeadTask);
  check("head can create a future To Do task", manualHeadTask.status === 200 && Boolean(manualHeadBody.event.taskId), manualHeadTask.status);

  const firstHeadTaskId = headTasks.sort((a, b) => a.plannedFrom - b.plannedFrom)[0]?.id;
  const secondHeadTaskId = headTasks.sort((a, b) => a.plannedFrom - b.plannedFrom)[1]?.id;
  const headTimeLog = await req(`/api/head-shifts/${headShiftId}/tasks/${firstHeadTaskId}/time-log`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${head.token}` },
    body: JSON.stringify({ startedAt: now - 20 * 60_000, endedAt: now - 10 * 60_000, note: "Past interval" }),
  });
  check("head can log a past time interval", headTimeLog.status === 200, headTimeLog.status);

  const headComplete = await req(`/api/head-shifts/${headShiftId}/tasks/${secondHeadTaskId}/complete`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${head.token}` },
    body: JSON.stringify({}),
  });
  check("head can mark a task done without a timer", headComplete.status === 200, headComplete.status);

  const headEnd = await req(`/api/head-shifts/${headShiftId}/end`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${head.token}` },
    body: JSON.stringify({}),
  });
  const headEndBody = await json<{ summary: { tasksTotal: number; tasksDone: number; missedCount: number } }>(headEnd);
  check(
    "head shift end records a summary and misses unfinished tasks",
    headEnd.status === 200 && headEndBody.summary.tasksTotal === 15 && headEndBody.summary.tasksDone === 2 && headEndBody.summary.missedCount === 13,
    headEndBody.summary,
  );

  const analyticsAfterHead = await req("/api/analytics/unit?days=30", { headers: { Authorization: `Bearer ${head.token}` } });
  const analyticsAfterHeadBody = await json<{ shifts: number }>(analyticsAfterHead);
  check("head-nurse shifts are excluded from nurse analytics", analyticsAfterHeadBody.shifts === 1, analyticsAfterHeadBody);

  const csvAfterHead = await req("/api/export?type=summaries", { headers: { Authorization: `Bearer ${head.token}` } });
  const csvAfterHeadText = await csvAfterHead.text();
  check("head-nurse shifts are excluded from CSV export", csvAfterHead.status === 200 && !csvAfterHeadText.includes(headShiftId), csvAfterHeadText.slice(0, 200));

  const staleStartAt = Date.now() - 17 * 60 * 60_000;
  const staleHead = await req("/api/head-shifts", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${head.token}` },
    body: JSON.stringify({ unitId, type: "day", startedAt: staleStartAt }),
  });
  const staleHeadBody = await json<{ shift: { id: string } }>(staleHead);
  check("head can start a backdated shift for the limit check", staleHead.status === 200, staleHead.status);
  const staleHeadId = staleHeadBody.shift.id;
  const replacementHead = await req("/api/head-shifts", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${head.token}` },
    body: JSON.stringify({ unitId, type: "day" }),
  });
  const replacementBody = await json<{ shift: { id: string } }>(replacementHead);
  check(
    "expired head shift is auto-ended before a new shift starts",
    replacementHead.status === 200 && replacementBody.shift.id !== staleHeadId,
    { status: replacementHead.status, id: replacementBody.shift.id },
  );
  const staleDetail = await req(`/api/shifts/${staleHeadId}`, { headers: { Authorization: `Bearer ${head.token}` } });
  const staleDetailBody = await json<{ shift: { endedAt: number | null; summary: { tasksTotal: number; missedCount: number } | null } }>(staleDetail);
  check(
    "expired head shift is capped at 16 hours and its tasks are missed",
    staleDetail.status === 200 &&
      staleDetailBody.shift.endedAt !== null &&
      staleDetailBody.shift.summary?.tasksTotal === 14 &&
      staleDetailBody.shift.summary?.missedCount === 14,
    staleDetailBody.shift,
  );
  const endReplacement = await req(`/api/head-shifts/${replacementBody.shift.id}/end`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${head.token}` },
    body: JSON.stringify({}),
  });
  check("replacement head shift can be ended", endReplacement.status === 200, endReplacement.status);

  await pool.query("TRUNCATE survey_responses, shift_reviews, handover_reports, events, beds, shifts, task_templates, config, users CASCADE");
  console.log(failures ? `\n${failures} API check(s) failed.` : "\nAll API checks passed.");
  await pool.end();
  process.exit(failures ? 1 : 0);
}

main().catch(async (error) => {
  console.error(error);
  await pool.end().catch(() => {});
  process.exit(1);
});
