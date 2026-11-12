import { chromium } from "playwright";

/**
 * End-to-end nurse flow against the local production build.
 * Creates one real shift (and its events) so it can exercise the same paths a
 * nurse uses. Run `npm run db:reset-shifts -- --yes` afterwards if wanted.
 */
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
  await page.waitForFunction(() => !document.body.innerText.includes("Loading ICU TaskLog")).catch(() => {});
  await page.fill("#username", "amina");
  await page.fill("#pin", "1111");
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const submit = page.getByRole("button", { name: "Sign in" });
    if (await submit.count()) {
      await submit.waitFor({ state: "visible" });
      if (await submit.isEnabled()) await submit.click();
    }
    await page.waitForTimeout(3000);
    if (!page.url().includes("/login")) return;
  }
  throw new Error("Login failed");
}

await signIn();
if (page.url().includes("/shift-start")) {
  const start = page.getByRole("button", { name: /Start day shift/ });
  await start.waitFor({ state: "visible" });
  await page.waitForTimeout(600);
  if (await start.isEnabled()) {
    await start.click();
    await page.waitForTimeout(1500);
  }
}
console.log("started at", page.url());

await page.getByRole("button", { name: /Emergency on this bed/ }).first().click();
await page.getByRole("button", { name: "Start emergency" }).click();
await page.getByText("Emergency mode is active").first().waitFor({ state: "visible" });
console.log("emergency banner visible");
await page.screenshot({ path: "/tmp/opencode/icu-capture/30-emergency-mobile.png" });

await page.getByRole("button", { name: /End emergency & review deferrals/ }).first().click();
await page.getByRole("button", { name: "End emergency", exact: true }).click();
await page.waitForURL(/review-deferred/, { timeout: 20_000 }).catch(() => {});
console.log("after emergency end", page.url());

if (page.url().includes("review-deferred")) {
  await page.getByRole("heading", { name: "Confirm new times" }).waitFor({ state: "visible" });
  const proposals = await page.getByRole("button", { name: "Confirm time" }).count();
  console.log(`reschedule proposals: ${proposals}`);
  await page.screenshot({ path: "/tmp/opencode/icu-capture/31-review-deferred-mobile.png" });
  await page.getByRole("button", { name: "Confirm all" }).click();
  await page.getByText("All deferred tasks rescheduled.").first().waitFor({ state: "visible" });
  console.log("deferred tasks confirmed");
}

await page.goto("http://localhost:3000/tasks", { waitUntil: "networkidle" });
await page.waitForTimeout(700);
await page.getByRole("button", { name: /^Start / }).first().click();
await page.getByRole("button", { name: "Finish active task" }).waitFor({ state: "visible" });
const timerText = await page.locator(".font-mono").filter({ hasText: /^\d+:\d\d$/ }).first().innerText().catch(() => "n/a");
console.log("active timer", timerText);
await page.getByRole("button", { name: "Finish active task" }).click();
await page.waitForTimeout(800);
console.log("task completed");

await page.getByRole("button", { name: "Quick add task" }).click();
await page.getByRole("button", { name: /^Vital signs/ }).first().click();
await page.getByText(/Vital signs.*added|Task added/i).first().waitFor({ state: "visible", timeout: 10_000 }).catch(() => {});
console.log("quick add used");
await page.screenshot({ path: "/tmp/opencode/icu-capture/32-after-quick-add-mobile.png" });

await page.goto("http://localhost:3000/handover", { waitUntil: "networkidle" });
await page.waitForTimeout(600);
await page.getByRole("button", { name: "Finalize handover" }).click();
await page.getByRole("button", { name: "Finalize handover" }).last().click();
await page.getByText("Handover already finalized").first().waitFor({ state: "visible" });
console.log("handover finalized");
await page.screenshot({ path: "/tmp/opencode/icu-capture/33-handover-finalized-mobile.png", fullPage: true });

await page.goto("http://localhost:3000/summary", { waitUntil: "networkidle" });
await page.waitForTimeout(800);
await page.screenshot({ path: "/tmp/opencode/icu-capture/34-summary-open-mobile.png", fullPage: true });
await page.getByRole("button", { name: "End shift now" }).click();
await page.getByRole("button", { name: "End shift" }).last().click();
await page.waitForTimeout(1200);
console.log("after end shift", page.url());
await page.screenshot({ path: "/tmp/opencode/icu-capture/35-summary-finished-mobile.png", fullPage: true });

await page.goto("http://localhost:3000/shift-start", { waitUntil: "networkidle" });
await page.waitForTimeout(600);
const stillActive = await page.getByText("A shift is already active").count();
console.log("active-shift banner after end:", stillActive);

console.log("page errors", JSON.stringify(errors));
await browser.close();
