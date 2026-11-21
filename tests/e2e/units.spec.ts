import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

test.describe("dynamic unit flow", () => {
  test("assigned nurse can choose a unit at shift start", async ({ page }) => {
    await signIn(page, "amina", "1111");
    await expect(page).toHaveURL(/\/shift-start/);
    await expect(page.getByRole("button", { name: /Unit A/ }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /Start day shift · Unit A/ })).toBeEnabled();
  });

  test("head nurse creates and removes an unused unit", async ({ page }) => {
    const unitName = `E2E Unit ${Date.now()}`;
    await signIn(page, "head", "9999");
    await page.goto("/head/units");

    await expect(page.getByRole("heading", { name: "Units" })).toBeVisible();
    await page.fill("#new-unit-name", unitName);
    await page.getByRole("button", { name: "Create unit" }).click();
    await expect(page.getByText(unitName).first()).toBeVisible();

    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Delete unused" }).click();
    await expect(page.getByText(/Unit deleted|No units yet/).first()).toBeVisible();
  });
});
