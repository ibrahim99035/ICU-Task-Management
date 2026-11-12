import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const OUT = "/home/ibrahim/sandbox/ICU-Task-Management/evaluation/screenshots";
mkdirSync(OUT, { recursive: true });
const executablePath =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ??
  "/home/ibrahim/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome";
const browser = await chromium.launch({ executablePath });
const problems = [];

async function newPage(viewport, mobile = false) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: mobile ? 2 : 1 });
  const page = await context.newPage();
  page.on("pageerror", (error) => problems.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("404")) problems.push(message.text());
  });
  return { context, page };
}

async function signIn(page, username, pin) {
  await page.goto("http://localhost:3000/login", { waitUntil: "networkidle" });
  await page.waitForSelector("#username", { state: "visible" });
  await page.waitForFunction(() => !document.body.innerText.includes("Loading ICU TaskLog")).catch(() => {});
  await page.fill("#username", username);
  await page.fill("#pin", pin);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const submit = page.getByRole("button", { name: "Sign in" });
    if (await submit.count()) {
      await submit.waitFor({ state: "visible" });
      if (await submit.isEnabled()) await submit.click();
    }
    await page.waitForTimeout(3000);
    if (!page.url().includes("/login")) return;
  }
  throw new Error(`Login failed for ${username}`);
}

async function hideBottomNav(page) {
  await page.addStyleTag({ content: "nav.no-print.fixed{display:none!important}" });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(250);
}

// 01 — login, desktop
{
  const { context, page } = await newPage({ width: 1440, height: 1000 });
  await page.goto("http://localhost:3000/login", { waitUntil: "networkidle" });
  await page.waitForFunction(() => !document.body.innerText.includes("Loading ICU TaskLog")).catch(() => {});
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/01-login.png` });
  await context.close();
}

// 02–09 — nurse flow
{
  const { context, page } = await newPage({ width: 390, height: 844 }, true);
  await signIn(page, "amina", "1111");
  if (!page.url().includes("/shift-start")) throw new Error(`Expected shift start, got ${page.url()}`);
  await page.waitForTimeout(600);
  await hideBottomNav(page);
  await page.screenshot({ path: `${OUT}/02-shift-start.png`, fullPage: true });

  await page.getByRole("button", { name: /Start day shift/ }).click();
  await page.waitForTimeout(1500);
  await hideBottomNav(page);
  await page.screenshot({ path: `${OUT}/03-beds.png`, fullPage: true });

  await page.goto("http://localhost:3000/tasks", { waitUntil: "networkidle" });
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}/04-tasks.png` });

  await page.getByRole("button", { name: /^Start / }).first().click();
  await page.waitForTimeout(65_000);
  await page.screenshot({ path: `${OUT}/05-active-timer.png` });

  await page.getByRole("button", { name: "Quick add task" }).click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/06-quick-add.png` });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);

  await page.getByRole("button", { name: "Finish active task" }).click();
  await page.waitForTimeout(600);
  await page.goto("http://localhost:3000/beds", { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  await page.getByRole("button", { name: /Emergency on this bed/ }).first().click();
  await page.getByRole("button", { name: "Start emergency" }).click();
  await page.getByText("Emergency mode is active").first().waitFor({ state: "visible" });
  await page.waitForTimeout(5000);
  await page.screenshot({ path: `${OUT}/07-emergency.png` });

  await page.getByRole("button", { name: /End emergency & review deferrals/ }).first().click();
  await page.getByRole("button", { name: "End emergency", exact: true }).click();
  await page.waitForURL(/review-deferred/, { timeout: 20_000 });
  await page.getByRole("heading", { name: "Confirm new times" }).waitFor({ state: "visible" });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/08-reschedule.png` });
  await page.getByRole("button", { name: "Confirm all" }).click();
  await page.getByText("All deferred tasks rescheduled.").first().waitFor({ state: "visible" });

  await page.goto("http://localhost:3000/handover", { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  await page.fill("#handover-note", "Watch the airway plan. Deferred care has new times. Family update still due.");
  await page.getByRole("button", { name: "Finalize handover" }).click();
  await page.getByRole("button", { name: "Finalize handover" }).last().click();
  await page.getByText("Handover already finalized").first().waitFor({ state: "visible" });
  await hideBottomNav(page);
  await page.screenshot({ path: `${OUT}/09-handover.png`, fullPage: true });
  await context.close();
}

// 10 + 16 — simulated finished summary and surveys (same nurse account)
{
  const { context, page } = await newPage({ width: 390, height: 844 }, true);
  await signIn(page, "amina", "1111");
  await page.getByText("Synced", { exact: true }).first().waitFor({ state: "visible", timeout: 25_000 }).catch(() => {});
  await page.waitForTimeout(1500);
  await page.goto("http://localhost:3000/summary?shift=sim-20261109-u-nurse-1", { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  await hideBottomNav(page);
  await page.screenshot({ path: `${OUT}/10-summary.png`, fullPage: true });

  await page.goto("http://localhost:3000/surveys", { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  await hideBottomNav(page);
  await page.screenshot({ path: `${OUT}/16-surveys.png`, fullPage: true });
  await context.close();
}

// 11–15 — head nurse, desktop
{
  const { context, page } = await newPage({ width: 1440, height: 1000 });
  await signIn(page, "head", "9999");
  await page.getByRole("heading", { name: "Unit dashboard" }).waitFor({ state: "visible" });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/11-head-dashboard.png`, fullPage: true });

  await page.goto("http://localhost:3000/head/shifts", { waitUntil: "networkidle" });
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}/12-head-shifts.png`, fullPage: true });

  const firstShift = page.locator("tr", { hasText: "Needs review" }).getByRole("link", { name: /^Open$/ }).first();
  await firstShift.click();
  await page.getByText("Event timeline").first().waitFor({ state: "visible", timeout: 25_000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/13-head-shift-detail.png`, fullPage: true });

  await page.getByRole("link", { name: /Write review|View review/ }).first().click();
  await page.getByText("Five manual ratings, no composite score").first().waitFor({ state: "visible", timeout: 20_000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/14-head-review.png`, fullPage: true });

  await page.goto("http://localhost:3000/head/export", { waitUntil: "networkidle" });
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}/15-head-export.png`, fullPage: true });
  await context.close();
}

console.log("captured to", OUT);
console.log("problems", JSON.stringify(problems));
await browser.close();
