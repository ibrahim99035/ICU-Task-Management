import { chromium } from "playwright";

/** Verifies that task actions keep working while the browser is offline. */
const executablePath =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ??
  "/home/ibrahim/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome";
const browser = await chromium.launch({ executablePath });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const page = await context.newPage();

await page.goto("http://localhost:3000/login", { waitUntil: "networkidle" });
await page.waitForSelector("#username", { state: "visible" });
await page.waitForFunction(() => !document.body.innerText.includes("Loading ICU TaskLog")).catch(() => {});
await page.fill("#username", "amina");
await page.fill("#pin", "1111");
for (let attempt = 0; attempt < 4; attempt += 1) {
  const submit = page.getByRole("button", { name: "Sign in" });
  if (await submit.count() && await submit.isEnabled()) await submit.click();
  await page.waitForTimeout(3000);
  if (!page.url().includes("/login")) break;
}
if (page.url().includes("/login")) throw new Error("Login failed");

if (page.url().includes("/shift-start")) {
  const start = page.getByRole("button", { name: /Start day shift/ });
  await start.waitFor({ state: "visible" });
  await page.waitForTimeout(500);
  if (await start.isEnabled()) {
    await start.click();
    await page.waitForTimeout(1200);
  }
}
await page.goto("http://localhost:3000/tasks", { waitUntil: "networkidle" });
await page.waitForTimeout(600);

await context.setOffline(true);
const start = page.getByRole("button", { name: /^Start / }).first();
await start.click();
await page.getByRole("button", { name: "Finish active task" }).waitFor({ state: "visible" });
console.log("offline start: active timer visible");
await page.screenshot({ path: "/tmp/opencode/icu-capture/40-offline-active.png" });

await page.getByRole("button", { name: "Finish active task" }).click();
await page.waitForTimeout(800);
console.log("offline finish: active timer hidden", (await page.getByRole("button", { name: "Finish active task" }).count()) === 0);

await page.getByRole("button", { name: "Quick add task" }).click();
await page.getByRole("button", { name: /^Vital signs/ }).first().click();
await page.waitForTimeout(500);
console.log("offline quick add: sheet closed", (await page.getByRole("heading", { name: "Quick add task" }).count()) === 0);
await page.screenshot({ path: "/tmp/opencode/icu-capture/41-offline-queue.png" });

await context.setOffline(false);
for (let i = 0; i < 20; i += 1) {
  await page.waitForTimeout(1500);
  const text = (await page.locator("header button").last().innerText().catch(() => "")).replace(/\s+/g, " ").trim();
  if (!text.includes("Syncing")) {
    console.log("sync chip after reconnect:", text);
    break;
  }
  if (i === 19) console.log("sync chip after reconnect: still syncing");
}
const outbox = await page.evaluate(async () => {
  const request = indexedDB.open("icu-tasklog");
  const database = await new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const tx = database.transaction("outbox", "readonly");
  return await new Promise((resolve, reject) => {
    const count = tx.objectStore("outbox").count();
    count.onsuccess = () => resolve(count.result);
    count.onerror = () => reject(count.error);
  });
});
console.log("outbox items after reconnect:", outbox);
await browser.close();
