import { chromium } from "playwright";

const executablePath =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ??
  "/home/ibrahim/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome";
const browser = await chromium.launch({ executablePath });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
await page.goto("http://localhost:3000/login", { waitUntil: "networkidle" });
await page.waitForSelector("#username", { state: "visible" });
await page.waitForFunction(() => !document.body.innerText.includes("Loading ICU TaskLog")).catch(() => {});
await page.fill("#username", "head");
await page.fill("#pin", "9999");
for (let attempt = 0; attempt < 5; attempt += 1) {
  const submit = page.getByRole("button", { name: "Sign in" });
  if (await submit.count() && await submit.isEnabled()) await submit.click();
  await page.waitForTimeout(3000);
  if (!page.url().includes("/login")) break;
}
await page.getByRole("heading", { name: "Unit dashboard" }).waitFor({ state: "visible" });
await page.waitForTimeout(1200);
await page.screenshot({
  path: "/home/ibrahim/sandbox/ICU-Task-Management/evaluation/screenshots/11-head-dashboard.png",
  fullPage: true,
});
await browser.close();
console.log("head dashboard recaptured");
