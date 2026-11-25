import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

function clock(ms: number): string {
  return new Date(ms).toTimeString().slice(0, 5);
}

test.describe("To Do and Time Log", () => {
  test("nurse sees shift tasks, plans a future task and logs a past interval", async ({ page }) => {
    await signIn(page, "yara", "2222");
    await page.goto("/shift-start");
    await expect(page.getByRole("heading", { name: /Start a shift/ })).toBeVisible();

    await expect(page.getByRole("button", { name: /Start day shift/ })).toBeVisible();
    const startShift = page.getByRole("button", { name: /Start day shift/ });
    if (await startShift.count()) {
      await startShift.first().click();
      await expect(page).toHaveURL(/\/tasks/);
    }

    await page.goto("/plan");
    await expect(page.getByRole("heading", { name: "To Do / Time Log" })).toBeVisible();
    await expect(page.getByRole("button", { name: /To do/ })).toBeVisible();
    await expect(page.getByText("Receive shift report").first()).toBeVisible();

    await page.getByRole("button", { name: "Plan a task" }).first().click();
    await page.fill("#plan-title", "E2E planned future task");
    await page.getByRole("button", { name: /Add to To do/ }).click();
    await expect(page.getByText("E2E planned future task").first()).toBeVisible();

    const report = page.locator("article").filter({ hasText: "Receive shift report" }).first();
    await report.getByRole("button", { name: "Log time" }).click();
    const now = Date.now();
    await page.fill("#log-start", clock(now - 20 * 60_000));
    await page.fill("#log-end", clock(now - 10 * 60_000));
    await page.getByRole("button", { name: "Save time log" }).click();
    await expect(page.getByText(/Time log saved/).first()).toBeVisible();

    await page.getByRole("button", { name: /Time log/ }).click();
    await expect(page.getByText("Receive shift report").first()).toBeVisible();
    await expect(page.getByText(/Logged/).first()).toBeVisible();

    await page.goto("/summary");
    await page.getByRole("button", { name: /End shift now/ }).click();
    await page.getByRole("dialog").getByRole("button", { name: "End shift" }).click();
    await expect(page.getByText(/Shift ended/).first()).toBeVisible();
  });


  test("nurse finalizes a shift-level handover", async ({ page }) => {
    await signIn(page, "amina", "1111");
    await page.goto("/shift-start");
    await expect(page.getByRole("button", { name: /Start day shift/ })).toBeVisible();
    const startShift = page.getByRole("button", { name: /Start day shift/ });
    if (await startShift.count()) {
      await startShift.first().click();
      await expect(page).toHaveURL(/\/tasks/);
    }

    await page.goto("/handover");
    await expect(page.getByRole("heading", { name: "Shift handover", level: 1 })).toBeVisible();
    await expect(page.getByText("Handover snapshot")).toBeVisible();
    await page.getByRole("button", { name: "Finalize handover" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Finalize handover" }).click();
    await expect(page.getByText("Handover already finalized")).toBeVisible();
  });

  test("head nurse starts a head-nurse shift and sees the 14-task list", async ({ page }) => {
    await signIn(page, "head", "9999");
    await page.goto("/head/tasks");
    await expect(page.getByRole("heading", { name: "My tasks" })).toBeVisible();

    await expect(
      page.getByText(/Start head-nurse shift|Receive shift report from previous shift/).first(),
    ).toBeVisible();

    const start = page.getByRole("button", { name: /Start head-nurse shift/ });
    if (await start.count()) {
      await start.click();
    }

    await expect(page.getByText("Receive shift report from previous shift").first()).toBeVisible();
    await expect(page.getByText("Hand over shift report to the next shift").first()).toBeVisible();

    await page.getByRole("button", { name: "Plan a task" }).first().click();
    await page.fill("#plan-title", "E2E head-nurse future task");
    await page.getByRole("button", { name: /Add to To do/ }).click();
    await expect(page.getByText("E2E head-nurse future task").first()).toBeVisible();

    const end = page.getByRole("button", { name: /End shift/ });
    if (await end.count()) {
      await end.click();
      await expect(page.getByText(/Head-nurse shift ended/).first()).toBeVisible();
    }
  });

  test("a shift older than 16 hours auto-ends and returns to shift start", async ({ page }) => {
    await signIn(page, "omar", "3333");
    await page.goto("/shift-start");
    await expect(page.getByRole("heading", { name: /Start a shift/ })).toBeVisible();

    await expect(page.getByRole("button", { name: /Start day shift/ })).toBeVisible();
    const startShift = page.getByRole("button", { name: /Start day shift/ });
    if (await startShift.count()) {
      await startShift.first().click();
      await expect(page).toHaveURL(/\/tasks/);
    }

    await page.evaluate(async () => {
      const request = indexedDB.open("tasklog");
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const tx = db.transaction("shifts", "readwrite");
      const store = tx.objectStore("shifts");
      const rows = await new Promise<any[]>((resolve, reject) => {
        const read = store.getAll();
        read.onsuccess = () => resolve(read.result);
        read.onerror = () => reject(read.error);
      });
      const active = rows.find((row) => !row.endedAt);
      if (!active) throw new Error("No active shift to age");
      active.startedAt = Date.now() - 17 * 60 * 60_000;
      await new Promise<void>((resolve, reject) => {
        const write = store.put(active);
        write.onsuccess = () => resolve();
        write.onerror = () => reject(write.error);
      });
      await new Promise<void>((resolve) => {
        tx.oncomplete = () => resolve();
      });
      db.close();
    });

    await page.goto("/tasks");
    await expect(page).toHaveURL(/\/shift-start/, { timeout: 30_000 });
    await expect(page.getByText(/auto-ended after 16 hours/i).first()).toBeVisible();
  });

});
