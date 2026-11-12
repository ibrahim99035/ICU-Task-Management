import { existsSync, renameSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";

/**
 * Static export for the Capacitor APK.
 *
 * A Next.js static export cannot contain server route handlers, so the Hono
 * API route is temporarily moved out of the app directory while the mobile
 * build runs. It is always restored, even when the build fails.
 */
const apiDir = "src/app/api";
const backup = ".api-route-backup";
const nextBin = process.platform === "win32" ? "next.cmd" : "./node_modules/.bin/next";

if (existsSync(backup)) rmSync(backup, { recursive: true, force: true });
if (existsSync(apiDir)) renameSync(apiDir, backup);

rmSync(".next", { recursive: true, force: true });
rmSync("out", { recursive: true, force: true });

let status = 1;
try {
  const result = spawnSync(nextBin, ["build", "--webpack"], {
    stdio: "inherit",
    env: { ...process.env, NEXT_BUILD_TARGET: "mobile" },
    shell: process.platform === "win32",
  });
  status = result.status ?? 1;
} finally {
  if (existsSync(backup)) renameSync(backup, apiDir);
}

process.exit(status);
