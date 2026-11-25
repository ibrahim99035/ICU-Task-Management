import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

/**
 * End-to-end nurse flow against the local production build.
 * Creates one real shift (and its events) so it can exercise the same paths a
 * nurse uses. Run `npm run db:reset-shifts -- --yes` afterwards if wanted.
 */
mkdirSync("/tmp/opencode/icu-capture", { recursive: true });

const executablePath =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ??
  "/home/ibrahim/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome";
const browser = await chromium.launch({ executablePath });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));
page.on("console", (message) => {
  if (message.type() === "error" && !message.text().includes("404")) errors.push(message.text());
});

async function signIn() {
  await page.goto("http://localhost:3000/login", { waitUntil: "networkidle" });
  await page.waitForSelector("#username", { state: "visible" });
  await page.fill("#username", "amina");
  await page.fill("#pin", "1111");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page
    .waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 20_000 })
    .catch(() => undefined);
  if (page.url().includes("/login")) throw new Error("Login failed");
  await page.waitForFunction(() => localStorage.getItem("tasklog_token"), undefined, { timeout: 20_000 });
}

await signIn();
console.log("signed in at", page.url());

await page.goto("http://localhost:3000/shift-start", { waitUntil: "networkidle" });
await page.waitForFunction(
  () => document.body.innerText.includes("Start day shift") || document.body.innerText.includes("Continue shift"),
  undefined,
  { timeout: 20_000 },
);
await page.waitForFunction(
  () => document.body.innerText.includes("Unit A") || document.body.innerText.includes("Continue shift"),
  undefined,
  { timeout: 20_000 },
).catch(() => {});
const start = page.getByRole("button", { name: /Start day shift/ });
if (await start.count()) {
  const unitButton = page.getByRole("button", { name: /Unit A/ }).first();
  if (await unitButton.count()) await unitButton.click();
  await start.click();
} else {
  const continueShift = page.getByRole("button", { name: /Continue shift/ });
  if (await continueShift.count()) await continueShift.click();
}
await page.waitForURL(/\/tasks/, { timeout: 20_000 });
console.log("started at", page.url());
await page.screenshot({ path: "/tmp/opencode/icu-capture/30-task-queue-mobile.png", fullPage: true });

await page.getByRole("button", { name: /^Start / }).first().click();
await page.getByRole("button", { name: "Finish active task" }).waitFor({ state: "visible" });
const timerText = await page.locator(".font-mono").filter({ hasText: /^\d+:\d\d$/ }).first().innerText().catch(() => "n/a");
console.log("active timer", timerText);
await page.getByRole("button", { name: "Finish active task" }).click();
await page.waitForTimeout(800);
console.log("task completed");

await page.getByRole("button", { name: "Quick add task" }).click();
await page.fill("#quick-title", "Check infusion site");
await page.getByRole("button", { name: "Add task", exact: true }).click();
await page.getByText(/Task added/i).first().waitFor({ state: "visible", timeout: 10_000 }).catch(() => {});
console.log("quick add used");
await page.screenshot({ path: "/tmp/opencode/icu-capture/31-after-quick-add-mobile.png" });

await page.goto("http://localhost:3000/handover", { waitUntil: "networkidle" });
await page.getByRole("heading", { name: "Shift handover", level: 1 }).waitFor({ state: "visible" });
await page.getByRole("button", { name: "Finalize handover" }).click();
await page.getByRole("button", { name: "Finalize handover" }).last().click();
await page.getByText("Handover already finalized").first().waitFor({ state: "visible" });
console.log("handover finalized");
await page.screenshot({ path: "/tmp/opencode/icu-capture/32-handover-finalized-mobile.png", fullPage: true });

await page.goto("http://localhost:3000/me", { waitUntil: "networkidle" });
await page.getByRole("button", { name: "Test alarm" }).click();
const alarmFeedback = await page
  .getByText(/Test alarm played|Alarm is off or audio is blocked/i)
  .first()
  .innerText()
  .catch(() => "no feedback");
console.log("alarm feedback", alarmFeedback);

await page.goto("http://localhost:3000/summary", { waitUntil: "networkidle" });
await page.waitForTimeout(800);
await page.screenshot({ path: "/tmp/opencode/icu-capture/33-summary-open-mobile.png", fullPage: true });
await page.getByRole("button", { name: "End shift now" }).click();
await page.getByRole("button", { name: "End shift" }).last().click();
await page.waitForTimeout(1200);
console.log("after end shift", page.url());
await page.screenshot({ path: "/tmp/opencode/icu-capture/34-summary-finished-mobile.png", fullPage: true });

await page.goto("http://localhost:3000/shift-start", { waitUntil: "networkidle" });
await page.waitForTimeout(600);
const stillActive = await page.getByText("A shift is already active").count();
console.log("active-shift banner after end:", stillActive);

console.log("page errors", JSON.stringify(errors));
await browser.close();
