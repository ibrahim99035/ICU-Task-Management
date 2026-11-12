import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const OUT = "/tmp/opencode/icu-capture";
mkdirSync(OUT, { recursive: true });
const executablePath = "/home/ibrahim/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome";
const browser = await chromium.launch({ executablePath });
const errors = [];

async function login(page, username, pin) {
  await page.goto("http://localhost:3000/login", { waitUntil: "networkidle" });
  await page.waitForSelector("#username", { state: "visible" });
  await page.waitForFunction(() => !document.body.innerText.includes("Loading ICU TaskLog"), undefined, { timeout: 20000 }).catch(() => {});
  await page.fill("#username", username);
  await page.fill("#pin", pin);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const submit = page.locator('button[type="submit"]');
    if (await submit.count()) {
      await submit.waitFor({ state: "visible" });
      if (await submit.isEnabled()) await submit.click();
    }
    await page.waitForTimeout(3500);
    if (!page.url().includes("/login")) return;
    console.log(`login retry ${attempt + 1} for ${username}`);
    await page.waitForTimeout(1500);
  }
  throw new Error(`Login failed for ${username}: ${await page.locator("body").innerText()}`);
}

async function nurseFlow() {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  page.on("console", (message) => { if (message.type() === "error") errors.push(`nurse console: ${message.text()}`); });
  page.on("pageerror", (error) => errors.push(`nurse pageerror: ${String(error)}`));
  await login(page, "amina", "1111");
  console.log("nurse after login", page.url());
  if (page.url().includes("shift-start")) {
    await page.getByRole("button", { name: /Start day shift/ }).waitFor({ state: "visible" });
    await page.waitForTimeout(500);
    await page.getByRole("button", { name: /Start day shift/ }).click();
    await page.waitForTimeout(1500);
  }
  await page.screenshot({ path: `${OUT}/10-beds-mobile.png` });
  await page.goto("http://localhost:3000/tasks", { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/11-tasks-mobile.png` });

  const start = page.getByRole("button", { name: /^Start / }).first();
  if (await start.count()) {
    await start.click();
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${OUT}/12-running-mobile.png` });
  }

  await page.getByRole("button", { name: /^Open / }).first().click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/13-task-detail-mobile.png` });
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: /Quick add task/ }).click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/14-quick-add-mobile.png` });
  await page.keyboard.press("Escape");

  await page.goto("http://localhost:3000/handover", { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/15-handover-mobile.png` });

  await page.goto("http://localhost:3000/summary", { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/16-summary-preview-mobile.png`, fullPage: true });

  await page.goto("http://localhost:3000/surveys", { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/17-surveys-mobile.png` });

  await page.goto("http://localhost:3000/me", { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/18-me-mobile.png` });

  await context.close();
}

async function headFlow() {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.on("console", (message) => { if (message.type() === "error") errors.push(`head console: ${message.text()}`); });
  page.on("pageerror", (error) => errors.push(`head pageerror: ${String(error)}`));
  await login(page, "head", "9999");
  console.log("head after login", page.url());
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${OUT}/20-head-dashboard-desktop.png`, fullPage: true });

  await page.goto("http://localhost:3000/head/shifts", { waitUntil: "networkidle" });
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}/21-head-shifts-desktop.png`, fullPage: true });

  const firstShift = page.locator("tr", { hasText: "Needs review" }).getByRole("link", { name: /^Open$/ }).first();
  if (await firstShift.count()) {
    await firstShift.click();
    await page.getByText("Event timeline").first().waitFor({ state: "visible", timeout: 25000 }).catch(() => {});
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${OUT}/22-head-shift-desktop.png`, fullPage: true });
    const review = page.getByRole("link", { name: /Write review|View review/ }).first();
    if (await review.count()) {
      await review.click();
      await page.getByText("Five manual ratings, no composite score").first().waitFor({ state: "visible", timeout: 20000 }).catch(() => {});
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${OUT}/23-head-review-desktop.png`, fullPage: true });
    }
  }

  await page.goto("http://localhost:3000/head/export", { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/24-head-export-desktop.png`, fullPage: true });

  await page.goto("http://localhost:3000/me", { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/25-head-me-desktop.png` });

  await context.close();
}

if (!process.argv.includes("--head-only")) await nurseFlow();
if (!process.argv.includes("--nurse-only")) await headFlow();
console.log("errors", JSON.stringify(errors, null, 2));
await browser.close();
