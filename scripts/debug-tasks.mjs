import { chromium } from "playwright";

const browser = await chromium.launch({
  executablePath: "/home/ibrahim/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome",
});
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await context.newPage();
page.on("console", (m) => console.log("console", m.type(), m.text()));
page.on("pageerror", (e) => console.log("pageerror", String(e)));
page.on("framenavigated", (f) => { if (f === page.mainFrame()) console.log("nav", f.url()); });

await page.goto("http://localhost:3000/login", { waitUntil: "networkidle" });
await page.fill("#username", "amina");
await page.fill("#pin", "1111");
await page.click('button[type="submit"]');
await page.waitForTimeout(2500);
console.log("after login", page.url());
if (page.url().includes("shift-start")) {
  const buttons = await page.getByRole("button").allTextContents();
  console.log("buttons", buttons);
  const start = page.getByRole("button", { name: /Start day shift/ });
  console.log("start count", await start.count(), "disabled", await start.first().isDisabled().catch(() => "n/a"));
  if (await start.count() && !(await start.first().isDisabled())) {
    await start.click();
    await page.waitForTimeout(1500);
  }
}
console.log("after start", page.url());
console.log("auth", await page.evaluate(() => localStorage.getItem("icu_auth")));
console.log("token", await page.evaluate(() => localStorage.getItem("icu_token") ? "yes" : "no"));
console.log("indexed", await page.evaluate(async () => {
  const req = indexedDB.open("icu-tasklog");
  const db = await new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
  const tx = db.transaction("shifts", "readonly");
  const all = await new Promise((resolve, reject) => { const r = tx.objectStore("shifts").getAll(); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
  return all;
}));
await page.goto("http://localhost:3000/tasks", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(3000);
console.log("after tasks", page.url());
console.log("text", (await page.locator("body").innerText()).slice(0, 500));
await page.screenshot({ path: "/tmp/opencode/icu-shots/debug-tasks.png", fullPage: false });
await browser.close();
