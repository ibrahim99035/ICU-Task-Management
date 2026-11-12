import "dotenv/config";
import bcrypt from "bcryptjs";
import { Pool } from "pg";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { DomainEvent } from "../src/domain";
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
    TRUNCATE survey_responses, shift_reviews, handover_reports, events, beds, shifts, task_templates, config, users CASCADE
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
      "INSERT INTO task_templates (id, name, category, tier, interval_min, expected_min, offset_min, active) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
      [template.id, template.name, template.category, template.tier, template.intervalMin, template.expectedMin, template.offsetMin, template.active],
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
      payload: { shiftType: "day", bedLabels: ["Bed 1"] },
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
        dueAt: start + 5 * 60_000,
        expectedMin: 10,
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

  const headLogin = await req("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "head", pin: "9999" }),
  });
  const head = await json<{ token: string }>(headLogin);
  check("head login returns a token", headLogin.status === 200 && head.token.length > 20, headLogin.status);

  const shifts = await req("/api/shifts", { headers: { Authorization: `Bearer ${head.token}` } });
  const shiftList = await json<{ shifts: { id: string; nurseName: string; reviewId: string | null }[] }>(shifts);
  check("head can list shifts", shifts.status === 200 && shiftList.shifts.length === 1 && shiftList.shifts[0].nurseName === "Amina Hassan", shiftList);

  const detail = await req("/api/shifts/api-test-shift", { headers: { Authorization: `Bearer ${head.token}` } });
  const detailBody = await json<{ events: unknown[]; review: unknown }>(detail);
  check("head can open shift detail", detail.status === 200 && detailBody.events.length === 5 && detailBody.review === null, detail.status);

  const analytics = await req("/api/analytics/unit?days=30", { headers: { Authorization: `Bearer ${head.token}` } });
  const analyticsBody = await json<{ shifts: number; avgCompletionRate: number }>(analytics);
  check("analytics includes the finished shift", analytics.status === 200 && analyticsBody.shifts === 1 && analyticsBody.avgCompletionRate === 1, analyticsBody);

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
  check("CSV export has a header and row", csv.status === 200 && text.includes("shift_id") && text.includes("api-test-shift"), text.slice(0, 200));

  const headForbidden = await req("/api/analytics/unit", { headers: { Authorization: `Bearer ${nurse.token}` } });
  check("nurse cannot use head analytics", headForbidden.status === 403, headForbidden.status);

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
