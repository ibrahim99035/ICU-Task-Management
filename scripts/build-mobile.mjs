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

if (existsSync(backup)) {
  if (!existsSync(apiDir)) {
    // Recover from a previous build that was killed before it could restore.
    renameSync(backup, apiDir);
  } else {
    rmSync(backup, { recursive: true, force: true });
  }
}
if (existsSync(apiDir)) renameSync(apiDir, backup);

let restored = false;
function restore() {
  if (restored) return;
  restored = true;
  if (existsSync(backup)) renameSync(backup, apiDir);
}
process.on("SIGINT", () => {
  restore();
  process.exit(130);
});
process.on("SIGTERM", () => {
  restore();
  process.exit(143);
});
process.on("exit", restore);

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
  restore();
}

process.exit(status);
