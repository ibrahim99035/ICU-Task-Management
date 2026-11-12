import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const OUT = "/tmp/opencode/icu-shots";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: "/home/ibrahim/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome",
});
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const page = await context.newPage();
const errors = [];
page.on("console", (message) => {
  if (message.type() === "error") errors.push(message.text());
});
page.on("pageerror", (error) => errors.push(String(error)));

await page.goto("http://localhost:3000/login", { waitUntil: "networkidle" });
await page.screenshot({ path: `${OUT}/01-login.png`, fullPage: false });
await page.fill("#username", "amina");
await page.fill("#pin", "1111");
await page.click('button[type="submit"]');
await page.waitForTimeout(2500);
console.log("after login:", page.url());
if (page.url().includes("shift-start")) {
  await page.screenshot({ path: `${OUT}/02-shift-start.png`, fullPage: false });
  await page.getByRole("button", { name: /Start day shift/ }).click();
  await page.waitForTimeout(1800);
}
console.log("after start:", page.url());
await page.screenshot({ path: `${OUT}/03-beds.png`, fullPage: false });

await page.goto("http://localhost:3000/tasks", { waitUntil: "networkidle" });
await page.waitForTimeout(900);
await page.screenshot({ path: `${OUT}/04-tasks.png`, fullPage: false });

const startButtons = page.getByRole("button", { name: /^Start / });
console.log("start buttons:", await startButtons.count());
if (await startButtons.count()) {
  await startButtons.first().click();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/05-running.png`, fullPage: false });
}

await page.goto("http://localhost:3000/handover", { waitUntil: "networkidle" });
await page.waitForTimeout(900);
await page.screenshot({ path: `${OUT}/06-handover.png`, fullPage: false });

console.log("console errors:", JSON.stringify(errors, null, 2));
await browser.close();
