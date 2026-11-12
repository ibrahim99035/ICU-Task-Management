import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions:
      executablePath && existsSync(executablePath) ? { executablePath } : undefined,
  },
  projects: [{ name: "chromium", use: { ...devices["Pixel 7"] } }],
  webServer: process.env.E2E_NO_SERVER
    ? undefined
    : {
        command: "npm run start",
        url: "http://localhost:3000/api/health",
        reuseExistingServer: true,
        timeout: 120_000,
      },
});
