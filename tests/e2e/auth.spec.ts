import { expect, test } from "@playwright/test";
import { signIn, waitForHydration } from "./helpers";

test.describe("authentication and role routing", () => {
  test("nurse signs in and lands on the shift start screen", async ({ page }) => {
    await signIn(page, "amina", "1111");
    await expect(page).toHaveURL(/\/(shift-start|beds)/);
    await expect(
      page.getByRole("heading", { name: /Start a shift|Bed board|Task queue/ }).first(),
    ).toBeVisible();
  });

  test("nurse can create an account and start a shift", async ({ page }) => {
    await page.goto("/login");
    await waitForHydration(page);
    await page.getByRole("tab", { name: "Create account" }).click();
    await page.fill("#username", `testnurse${Date.now()}`);
    await page.fill("#display-name", "Test Nurse");
    await page.fill("#pin", "2468");
    await page.fill("#confirm-pin", "2468");
    await page.getByRole("button", { name: "Create nurse account" }).click();
    await expect(page).toHaveURL(/\/shift-start/);
    await expect(page.getByRole("heading", { name: /Start a shift/ })).toBeVisible();
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
