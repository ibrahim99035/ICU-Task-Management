import { chromium } from "playwright";

const OUT = "/home/ibrahim/sandbox/ICU-Task-Management/evaluation/screenshots";
const executablePath =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ??
  "/home/ibrahim/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome";
const browser = await chromium.launch({ executablePath });

async function pageFor(viewport, mobile = false) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: mobile ? 2 : 1 });
  const page = await context.newPage();
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
    if (await submit.count() && await submit.isEnabled()) await submit.click();
    await page.waitForTimeout(3000);
    if (!page.url().includes("/login")) return;
  }
  throw new Error("login failed");
}
async function clean(page) {
  const dismiss = page.getByRole("button", { name: "Dismiss message" });
  if (await dismiss.count()) await dismiss.click().catch(() => {});
  await page.waitForTimeout(300);
}
async function readyShot(page, path, fullPage) {
  await clean(page);
  await page.addStyleTag({ content: "nav.no-print.fixed{display:none!important}" });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
  await page.screenshot({ path, fullPage });
}

{
  const { context, page } = await pageFor({ width: 390, height: 844 }, true);
  await signIn(page, "amina", "1111");
  await page.getByRole("button", { name: /Start day shift/ }).click();
  await page.waitForTimeout(2500);
  await readyShot(page, `${OUT}/03-beds.png`, true);

  await page.goto("http://localhost:3000/handover", { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  await page.fill("#handover-note", "Watch the airway plan. Deferred care has new times. Family update still due.");
  await page.getByRole("button", { name: "Finalize handover" }).click();
  await page.getByRole("button", { name: "Finalize handover" }).last().click();
  await page.getByText("Handover already finalized").first().waitFor({ state: "visible" });
  await page.waitForTimeout(4200);
  await readyShot(page, `${OUT}/09-handover.png`, true);
  await context.close();
}
await browser.close();
console.log("beds and handover recaptured");
