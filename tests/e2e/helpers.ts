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
  await page.getByRole("button", { name: "Sign in" }).click();

  await page
    .waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 20_000 })
    .catch(() => undefined);

  if (page.url().includes("/login")) {
    throw new Error(`Login failed for ${username}`);
  }
}
