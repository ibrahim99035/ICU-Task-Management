import { expect, type Page } from "@playwright/test";

export async function waitForHydration(page: Page) {
  await page.waitForSelector("#username", { state: "visible" });
  await page
    .waitForFunction(() => !document.body.innerText.includes("Loading ICU TaskLog"), undefined, {
      timeout: 20_000,
    })
    .catch(() => undefined);
}

export async function signIn(page: Page, username: string, pin: string) {
  await page.goto("/login");
  await waitForHydration(page);
  await page.fill("#username", username);
  await page.fill("#pin", pin);

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const submit = page.getByRole("button", { name: "Sign in" });
    if (await submit.count()) {
      await expect(submit).toBeEnabled();
      await submit.click();
    }
    await page.waitForTimeout(3000);
    if (!page.url().includes("/login")) return;
    await page.waitForTimeout(1000);
  }

  throw new Error(`Login failed for ${username}`);
}
