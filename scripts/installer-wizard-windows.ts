/**
 * Windows installer wizard — a dedicated, Windows-native installer.
 *
 * This is intentionally a SEPARATE entry point from scripts/installer-wizard.ts
 * (which is the POSIX/Linux installer). It is used only for `bun-windows-*`
 * targets and contains no `chmod`, `konsole`, `/dev/tty`, or `.desktop`
 * assumptions. It installs into %APPDATA% and creates real `.lnk` shortcuts.
 *
 * Compiled by scripts/build-installer.ts for bun-windows-* targets.
 * Imports the embedded portable binary + sqlite-vec native extension.
 */

import { join, dirname, basename } from "node:path";
import { homedir, tmpdir } from "node:os";
import { existsSync } from "node:fs";
import { readFile, writeFile, mkdir, rm, rename } from "node:fs/promises";
import { createInterface } from "node:readline";

import { PORTABLE_BINARY_BASE64 } from "./generated/embedded-portable";
import { VEC0_SO_BASE64, VEC0_SO_FILENAME } from "./generated/embedded-vec0";

const APPDATA = process.env.APPDATA || join(homedir(), "AppData", "Roaming");
const INSTALL_BASE = join(APPDATA, "visual-studio-harness");
const BINARY_NAME = "visual-studio-harness.exe";
const SHORTCUT_NAME = "Visual Studio Harness.lnk";
const DESKTOP = join(homedir(), "Desktop");
const START_MENU = join(APPDATA, "Microsoft", "Windows", "Start Menu", "Programs");

function pauseOnExit(): Promise<void> {
  process.stdout.write("\n  Press Enter to close...");
  return new Promise((resolve) => {
    process.stdin.resume();
    process.stdin.setEncoding("utf-8");
    process.stdin.once("data", () => resolve());
  });
}

async function numberedChoice(
  title: string,
  options: { label: string; value: string }[]
): Promise<string | null> {
  process.stdout.write(`\n  ${title}\n\n`);
  options.forEach((o, i) => process.stdout.write(`  ${i + 1}) ${o.label}\n`));
  process.stdout.write("\n");
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question("  Choice: ", (a) => {
      rl.close();
      const n = parseInt(a.trim(), 10);
      if (n >= 1 && n <= options.length) resolve(options[n - 1].value);
      else resolve(null);
    });
  });
}

async function makeShortcut(lnkPath: string, target: string) {
  await mkdir(dirname(lnkPath), { recursive: true });
  const esc = (v: string) => v.replace(/'/g, "''");
  const script =
    `$s=(New-Object -ComObject WScript.Shell).CreateShortcut('${esc(lnkPath)}');` +
    `$s.TargetPath='${esc(target)}';` +
    `$s.WorkingDirectory='${esc(dirname(target))}';` +
    `$s.Save();`;
  const p = Bun.spawn(["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script]);
  await p.exited;
}

async function removeShortcuts() {
  await rm(join(DESKTOP, SHORTCUT_NAME), { force: true }).catch(() => {});
  await rm(join(START_MENU, SHORTCUT_NAME), { force: true }).catch(() => {});
}


const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function isLockedErr(err: any): boolean {
  const code = String(err?.code || "");
  const msg = String(err?.message || "");
  return /EPERM|EBUSY|EACCES/.test(code) ||
    /being used by another process|another file|is in use/i.test(msg);
}

/**
 * Write the portable binary in place, tolerating Windows file locks.
 *   1) transactional rename; 2) retry (AV/Defender scan); 3) if the destination
 *   is locked by a still-running app, install a unique-named copy and let the
 *   caller repoint the shortcut to it instead of aborting.
 * Returns the path that was actually written.
 */
async function replaceExe(data: Buffer): Promise<string> {
  const dest = join(INSTALL_BASE, BINARY_NAME);
  const tmp = join(INSTALL_BASE, `.vsh.update.${process.pid}`);
  await writeFile(tmp, data);

  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await rename(tmp, dest);
      return dest;
    } catch (err) {
      if (!isLockedErr(err)) {
        await rm(tmp, { force: true }).catch(() => {});
        throw new Error(`Failed to write ${dest}: ${String((err as any)?.message || err)}`);
      }
    }
    await sleep(300);
  }

  // Destination is locked (old app still running / AV). Install alongside with a
  // unique name and repoint shortcuts to it; the old file is removed on a later
  // update once it is no longer running.
  const unique = join(INSTALL_BASE, `visual-studio-harness-${Date.now()}.exe`);
  await writeFile(unique, data);
  await rm(tmp, { force: true }).catch(() => {});
  process.stdout.write(
    `  \x1B[33m  \u26a0\x1B[0m ${BINARY_NAME} is in use; installed as ${basename(unique)}. ` +
    `Close the running app, then re-run the installer to consolidate.\n`
  );
  return unique;
}

async function doInstall() {
  const isUpdate = existsSync(join(INSTALL_BASE, "config.json"));
  await mkdir(INSTALL_BASE, { recursive: true });

  process.stdout.write("  Extracting...\n");
  const binaryData = Buffer.from(PORTABLE_BINARY_BASE64, "base64");
  const binaryPath = await replaceExe(binaryData);

  // Extract sqlite-vec native extension for vector search support
  if (VEC0_SO_BASE64) {
    const vec0Path = join(INSTALL_BASE, "data", VEC0_SO_FILENAME);
    await mkdir(dirname(vec0Path), { recursive: true });
    await writeFile(vec0Path, Buffer.from(VEC0_SO_BASE64, "base64"));
  }

  if (!isUpdate) {
    process.stdout.write("  Creating config...\n");
    await mkdir(join(INSTALL_BASE, "sessions"), { recursive: true });
    await mkdir(join(INSTALL_BASE, "logs"), { recursive: true });
    const defaultConfig = {
      providers: [
        {
          displayName: "OpenCode Zen",
          baseUrl: "https://opencode.ai/zen/v1",
          models: [{ displayName: "Default Model", modelName: "default" }],
        },
        {
          displayName: "Grok",
          baseUrl: "https://api.x.ai/v1",
          models: [
            { displayName: "Grok 4", modelName: "grok-4" },
            { displayName: "Grok 4 Fast", modelName: "grok-4-fast" },
            { displayName: "Grok 3", modelName: "grok-3" },
            { displayName: "Grok 3 Mini", modelName: "grok-3-mini" },
          ],
        },
      ],
      defaultProvider: "OpenCode Zen",
      defaultModel: "Default Model",
    };
    await writeFile(join(INSTALL_BASE, "config.json"), JSON.stringify(defaultConfig, null, 2) + "\n", "utf-8");
  }

  // Seed dev data if embedded (merge with existing on update)
  let seeded: any = { mcps: [], providers: [], agentConfigs: [], mds: [] };
  try { seeded = (await import("./generated/seeded-data")).SEEDED_DATA; } catch {}

  const configPath = join(INSTALL_BASE, "config.json");
  if (seeded.providers?.length) {
    const config = JSON.parse(await readFile(configPath, "utf-8"));
    for (const p of seeded.providers) {
      const i = config.providers.findIndex((x: any) => x.displayName === p.displayName);
      if (i >= 0) config.providers[i] = { ...config.providers[i], ...p };
      else config.providers.push(p);
    }
    await writeFile(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
  }
  if (seeded.mds?.length) {
    for (const md of seeded.mds) {
      const d = join(INSTALL_BASE, "mds", dirname(md.filename));
      await mkdir(d, { recursive: true });
      await writeFile(join(INSTALL_BASE, "mds", md.filename), md.content, "utf-8");
    }
  }

  process.stdout.write("  Creating shortcuts...\n");
  await makeShortcut(join(DESKTOP, SHORTCUT_NAME), binaryPath);
  await makeShortcut(join(START_MENU, SHORTCUT_NAME), binaryPath);

  await writeFile(
    join(INSTALL_BASE, "install-info.json"),
    JSON.stringify({ installedAt: new Date().toISOString() }, null, 2) + "\n",
    "utf-8"
  );
  process.stdout.write(`\x1B[32m  \u2713\x1B[0m Installed to: ${INSTALL_BASE}\n`);
}

async function doUninstall() {
  if (!existsSync(INSTALL_BASE)) {
    process.stdout.write("  Nothing to uninstall.\n");
    return;
  }
  process.stdout.write("  Uninstalling...\n");
  await removeShortcuts();

  // Windows locks running executables, so if this exe is inside the install
  // dir, copy ourselves to a temp location and let that copy delete it.
  if (process.execPath.toLowerCase().startsWith(INSTALL_BASE.toLowerCase())) {
    const selfData = await readFile(process.execPath);
    const selfCopy = join(tmpdir(), `vsh-uninstall-${process.pid}.exe`);
    await writeFile(selfCopy, selfData);
    Bun.spawn([selfCopy, "--delete-path", INSTALL_BASE], { detached: true }).unref();
    process.exit(0);
  }

  await rm(INSTALL_BASE, { recursive: true, force: true });
  process.stdout.write("\x1B[32m  \u2713\x1B[0m Uninstall complete.\n");
}

async function main() {
  const delIdx = process.argv.indexOf("--delete-path");
  if (delIdx >= 0 && process.argv[delIdx + 1]) {
    await rm(process.argv[delIdx + 1], { recursive: true, force: true });
    await removeShortcuts();
    await rm(process.execPath, { force: true }).catch(() => {});
    process.exit(0);
  }

  let hasSeed = false;
  try {
    const s = (await import("./generated/seeded-data")).SEEDED_DATA;
    hasSeed = !!(s.mcps?.length || s.providers?.length || s.agentConfigs?.length || s.mds?.length);
  } catch {}

  if (existsSync(INSTALL_BASE)) {
    const choice = await numberedChoice("Visual Studio Harness", [
      { label: hasSeed ? "Update (replace binary + merge seed data)" : "Update (replace binary)", value: "update" },
      { label: "Uninstall", value: "uninstall" },
    ]);
    if (choice === "update") {
      process.stdout.write("\n  Updating...\n");
      await doInstall();
      process.stdout.write("\n  \x1B[32m\u2713\x1B[0m Update complete.\n");
    } else if (choice === "uninstall") {
      await doUninstall();
      process.exit(0);
    }
  } else {
    const choice = await numberedChoice("Install Visual Studio Harness", [
      { label: "Install", value: "install" },
      { label: "Cancel", value: "cancel" },
    ]);
    if (choice === "install") {
      process.stdout.write("\n  Installing...\n");
      await doInstall();
      process.stdout.write("\n  \x1B[32m\u2713\x1B[0m Install complete.\n");
    }
  }
  await pauseOnExit();
}

main().catch((err) => {
  process.stdout.write(
    `\n\x1B[31m  \u2717 Installer failed:\x1B[0m ${err instanceof Error ? (err.stack || err.message) : String(err)}\n`
  );
  process.exit(1);
});
