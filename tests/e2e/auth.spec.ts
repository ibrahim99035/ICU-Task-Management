import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

test.describe("authentication and role routing", () => {
  test("nurse signs in and lands on the shift start screen", async ({ page }) => {
    await signIn(page, "amina", "1111");
    await expect(page).toHaveURL(/\/(shift-start|beds)/);
    await expect(
      page.getByRole("heading", { name: /Start a shift|Bed board|Task queue/ }).first(),
    ).toBeVisible();
  });

  test("head nurse signs in and sees the unit dashboard", async ({ page }) => {
    await signIn(page, "head", "9999");
    await expect(page).toHaveURL(/\/head/);
    await expect(page.getByRole("heading", { name: "Unit dashboard" })).toBeVisible();
    await expect(page.getByText("Tier 1–2 on time").first()).toBeVisible();
  });

  test("nurse cannot open head-nurse screens", async ({ page }) => {
    await signIn(page, "amina", "1111");
    await page.goto("/head/shifts");
    await expect(page).not.toHaveURL(/\/head/);
    await expect(page).toHaveURL(/\/(shift-start|beds)/);
  });

  test("privacy notice is readable after signing in", async ({ page }) => {
    await signIn(page, "amina", "1111");
    await page.goto("/privacy");
    await expect(page.getByRole("heading", { name: "Privacy & data" })).toBeVisible();
    await expect(page.getByText("No patient identifiers").first()).toBeVisible();
  });
});
