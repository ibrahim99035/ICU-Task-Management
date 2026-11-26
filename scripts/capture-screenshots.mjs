import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.E2E_BASE_URL ?? "https://icu-tasklog.vercel.app";
const OUT = "visual-guide/screenshots";
mkdirSync(OUT, { recursive: true });

const executablePath =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ??
  "/home/ibrahim/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome";

const browser = await chromium.launch({ executablePath });

let index = 0;

async function cap(page, name) {
  index += 1;
  const num = String(index).padStart(2, "0");
  const path = `${OUT}/${num}-${name}.png`;
  await page.screenshot({ path, fullPage: true });
  console.log(`[${num}] ${name} -> ${path}`);
}

async function waitForPage(page) {
  await page.waitForTimeout(2000);
  await page
    .waitForFunction(() => !document.body.innerText.includes("Loading ICU TaskLog"), {
      timeout: 15000,
    })
    .catch(() => {});
}

async function goto(page, path) {
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
  await waitForPage(page);
}

async function click(page, text) {
  const btn = page.getByRole("button", { name: new RegExp(text, "i") });
  await btn.waitFor({ state: "visible", timeout: 10000 });
  await btn.click();
  await page.waitForTimeout(2000);
}

async function newContext() {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
  });
  const pg = await ctx.newPage();
  return { ctx, pg };
}

async function signIn(page, username, pin) {
  await page.waitForSelector("#username", { state: "visible", timeout: 10000 });
  await page.fill("#username", username);
  await page.fill("#pin", pin);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForTimeout(3000);
}

// ============================================================
// NURSE SESSION
// ============================================================
const { ctx: nurseCtx, pg: n } = await newContext();

// 00 - Login page with fast buttons
await goto(n, "/login");
await cap(n, "00-login-fast-buttons");

// 01 - Fast nurse login redirects to tasks
await click(n, "Enter as Nurse");
await cap(n, "01-login-fast-nurse-redirect");

// 02 - Shift start: unit selection
await goto(n, "/shift-start");
await cap(n, "02-shift-start-unit-selection");

// Check if there's already an active shift - end it first
const activeShiftAlert = n.getByRole("alert", { name: /A shift is already active/ });
if ((await activeShiftAlert.count()) > 0) {
  await n.getByRole("button", { name: "End shift" }).click();
  await n.waitForTimeout(3000);
  await goto(n, "/shift-start");
  await cap(n, "02b-shift-start-ended-existing");
}

// Select Unit A
const unitA = n.getByRole("button", { name: /Unit A/ }).first();
await unitA.waitFor({ state: "visible", timeout: 10000 });
await unitA.click();
await n.waitForTimeout(1500);
await cap(n, "03-shift-start-unit-selected");

// Start day shift
try {
  const startBtn = n.getByRole("button", { name: /Start day shift/ });
  if ((await startBtn.count()) > 0) {
    await n.waitForFunction(() => {
      const btn = document.querySelector('button[class*="btn-primary"][class*="w-full"][class*="text-base"]');
      return btn && !btn.disabled;
    }, { timeout: 15000 });
    await click(n, "Start day shift");
  }
} catch (e) {
  console.log("Could not start shift, navigating to /tasks directly");
  await goto(n, "/tasks");
}
await cap(n, "04-tasks-to-do-tab");

// 05 - Active timer (start a task)
const startTask = n.getByRole("button", { name: /^Start / }).first();
if ((await startTask.count()) > 0) {
  await startTask.click();
  await n.waitForTimeout(1000);
  await cap(n, "05-tasks-active-timer");

  // Finish active task
  await n.getByRole("button", { name: "Finish active task" }).click();
  await n.waitForTimeout(1000);
  await cap(n, "06-tasks-task-finished");
}

// 07 - Quick add
await n.getByRole("button", { name: "Quick add task" }).click();
await n.waitForTimeout(1000);
await cap(n, "07-tasks-quick-add-open");

// Close any open dialogs/overlays first
await n.keyboard.press("Escape");
await n.waitForTimeout(500);

// 08 - Filter buttons: Overdue
await n.getByRole("button", { name: /Overdue/ }).click();
await n.waitForTimeout(1000);
await cap(n, "08-tasks-filter-overdue");

// 09 - Filter buttons: Done
await n.getByRole("button", { name: /Done/ }).click();
await n.waitForTimeout(1000);
await cap(n, "09-tasks-filter-done");

// 10 - Back to Open filter
await n.getByRole("button", { name: /Open/ }).first().click();
await n.waitForTimeout(1000);
await cap(n, "10-tasks-filter-open");

// ============================================================
// PLAN PAGE - To Do / Time Log
// ============================================================
await goto(n, "/plan");
await cap(n, "11-plan-to-do-time-log");

// Edit task modal from plan
const editBtn = n.getByRole("button", { name: /Edit/ }).first();
if ((await editBtn.count()) > 0) {
  await editBtn.click();
  await n.waitForTimeout(1000);
  await cap(n, "12-plan-task-edit-modal");
  await n.keyboard.press("Escape");
  await n.waitForTimeout(500);
}

// ============================================================
// HANDOVER
// ============================================================
await goto(n, "/handover");
await cap(n, "13-handover-draft");

const finalizeBtn = n.getByRole("button", { name: "Finalize handover" });
if ((await finalizeBtn.count()) > 0) {
  await finalizeBtn.click();
  await n.waitForTimeout(1000);
  await cap(n, "14-handover-finalize-dialog");
  const confirm = n.getByRole("dialog").getByRole("button", { name: "Finalize handover" });
  if ((await confirm.count()) > 0) {
    await confirm.click();
    await n.waitForTimeout(1000);
    await cap(n, "15-handover-finalized");
  }
}

// ============================================================
// ME / SETTINGS
// ============================================================
await goto(n, "/me");
await cap(n, "16-me-alarm-settings");
await n.getByRole("button", { name: "Test alarm" }).click();
await n.waitForTimeout(1500);
await cap(n, "17-me-test-alarm-feedback");

// ============================================================
// SUMMARY
// ============================================================
await goto(n, "/summary");
await cap(n, "18-summary-no-active-shift");

const endShiftBtn = n.getByRole("button", { name: /End shift now/ });
if ((await endShiftBtn.count()) > 0) {
  await endShiftBtn.click();
  await n.waitForTimeout(1000);
  await cap(n, "19-summary-end-shift-confirm");
  await n.getByRole("dialog").getByRole("button", { name: "End shift" }).click();
  await n.waitForTimeout(1500);
  await cap(n, "20-summary-finished");
}

await nurseCtx.close();

// ============================================================
// HEAD NURSE SESSION (fresh context)
// ============================================================
const { ctx: headCtx, pg: h } = await newContext();

await goto(h, "/login");
await cap(h, "21-login-fast-head-buttons");

await click(h, "Enter as Head nurse");
await cap(h, "22-login-fast-head-redirect");

await goto(h, "/head");
await cap(h, "23-head-dashboard");

await goto(h, "/head/shifts");
await cap(h, "24-head-shift-list");

await goto(h, "/head/tasks");
await cap(h, "25-head-tasks-my-tasks");

await goto(h, "/head/units");
await cap(h, "26-head-units-management");

await goto(h, "/head/review");
await cap(h, "27-head-review-ratings");

await goto(h, "/head/export");
await cap(h, "28-head-export-csv");

// Head shift detail
await goto(h, "/head/shifts");
await h.waitForTimeout(1000);
const firstShiftLink = h.getByRole("link", { name: /shift/i }).first();
if ((await firstShiftLink.count()) > 0) {
  await firstShiftLink.click();
  await h.waitForTimeout(1500);
  await cap(h, "29-head-shift-detail-timeline");
}

// ============================================================
// PRIVACY (public)
// ============================================================
const { ctx: pubCtx, pg: pub } = await newContext();
await goto(pub, "/privacy");
await cap(pub, "30-privacy-notice");

// ============================================================
// DONE
// ============================================================
await headCtx.close();
await pubCtx.close();
await browser.close();
console.log("\nAll screenshots captured in visual-guide/screenshots/");
console.log("Total:", index);
