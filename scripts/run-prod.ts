/**
 * Launch the compiled prod binary from data/prod/.
 * Keeps the process in the foreground so start.sh terminal stays open.
 * DATA_DIR env override: if set, uses that as the runtime data directory.
 */

import { join } from "node:path";
import { existsSync } from "node:fs";

const PROJECT = join(import.meta.dir, ".."); // repoSource/
const BINARY_NAME = process.platform === "win32" ? "visual-studio-harness.exe" : "visual-studio-harness";
const BINARY = join(PROJECT, "..", "data", "package", BINARY_NAME);

if (!existsSync(BINARY)) {
  console.error(`Prod binary not found: ${BINARY}`);
  console.error("Run: bun run build");
  process.exit(1);
}

const DATA_DIR = process.env.DATA_DIR
  ? (process.env.DATA_DIR.startsWith("/")
      ? process.env.DATA_DIR
      : join(PROJECT, process.env.DATA_DIR))
  : join(PROJECT, "..", "data", "prod");

console.log(`Starting ${BINARY}`);
console.log(`Data dir: ${DATA_DIR}`);
console.log("Open http://localhost:3002");
console.log("");

const proc = Bun.spawn([BINARY], {
  cwd: DATA_DIR,
  stdout: "inherit",
  stderr: "inherit",
  stdin: "inherit",
  env: {
    ...process.env,
    MODE: "prod",
    // Force absolute data dir so globalPerms.json is never resolved under /$bunfs
    DATA_DIR,
    BACKEND_PORT: process.env.BACKEND_PORT || "3002",
    "visual-studio-harness_IN_TERMINAL": "1",
  },
});

const code = await proc.exited;
process.exit(code);
