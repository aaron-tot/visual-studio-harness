/**
 * Installer wizard — arrow-key TUI with install, uninstall, and launch.
 *
 * Compiled as the installer binary entry point.
 * Imports the portable binary (embedded at build time).
 */

import { openSync } from "node:fs";
import { WriteStream, ReadStream } from "node:tty";
import { writeFile, mkdir, rm, readFile, rename } from "node:fs/promises";
import { join, dirname } from "node:path";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { createInterface } from "node:readline";

import { PORTABLE_BINARY_BASE64 } from "./generated/embedded-portable";

let stdin: ReadStream;
let ttyOut: WriteStream;

function initTTY() {
  if (stdin) return true;
  try {
    stdin = new ReadStream(process.stdin.fd);
    const fd = openSync("/dev/tty", "w");
    ttyOut = new WriteStream(fd);
    return true;
  } catch {
    return false;
  }
}

function cleanup() {
  try { stdin?.setRawMode(false); stdin?.destroy(); } catch {}
  try { ttyOut?.destroy(); } catch {}
}

function write(msg: string) {
  if (ttyOut) ttyOut.write(msg);
  else process.stdout.write(msg);
}

function waitForKey(): Promise<string> {
  return new Promise((resolve) => {
    const handler = (key: string) => {
      stdin.removeListener("data", handler);
      resolve(key);
    };
    stdin.on("data", handler);
  });
}

async function tuiMenu(title: string, options: { label: string; value: string }[]): Promise<string | null> {
  let cursor = 0;
  const allOptions = [...options, { label: "← Back", value: "__back__" }];

  if (!initTTY()) {
    // Fallback to simple prompt when no TTY available
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    write(`\n  ${title}\n\n`);
    for (let i = 0; i < options.length; i++) {
      write(`  ${i + 1}) ${options[i].label}\n`);
    }
    write("\n");
    return new Promise((resolve) => {
      rl.question("  Choice: ", (a) => {
        rl.close();
        const n = parseInt(a.trim(), 10);
        if (n >= 1 && n <= options.length) resolve(options[n - 1].value);
        else resolve(null);
      });
    });
  }

  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding("utf-8");

  function render() {
    write("\x1B[2J\x1B[H");
    write(`  \x1B[44m\x1B[97m\x1B[1m  ${title}  \x1B[0m\n`);
    write(`  \x1B[2m${"─".repeat(title.length + 4)}\x1B[0m\n\n`);
    for (let i = 0; i < allOptions.length; i++) {
      const pointer = i === cursor ? "\x1B[33m›\x1B[0m" : " ";
      const label = i === cursor ? `\x1B[1m${allOptions[i].label}\x1B[0m` : allOptions[i].label;
      write(`  ${pointer} ${label}\n`);
    }
    write(`\n  \x1B[2m↑↓ navigate · Enter select · Ctrl+C cancel\x1B[0m\n`);
  }

  render();

  while (true) {
    const key = await waitForKey();
    if (key === "\x1B[A" || key === "k") {
      cursor = cursor > 0 ? cursor - 1 : allOptions.length - 1;
      render();
    } else if (key === "\x1B[B" || key === "j") {
      cursor = cursor < allOptions.length - 1 ? cursor + 1 : 0;
      render();
    } else if (key === "\r" || key === "\n") {
      stdin.setRawMode(false);
      const val = allOptions[cursor].value;
      if (val === "__back__") return null;
      return val;
    } else if (key === "\u0003") {
      cleanup();
      process.exit(0);
    }
  }
}

async function pauseOnExit() {
  write(`\n  \x1B[2mPress Enter to close...\x1B[0m`);
  try {
    process.stdin.setRawMode(false);
    process.stdin.resume();
    process.stdin.setEncoding("utf-8");
    await new Promise<void>((resolve) => process.stdin.once("data", () => resolve()));
  } catch {}
}

const INSTALL_BASE = join(homedir(), ".config", "visual-studio-harness");

async function alreadyInstalled(): Promise<boolean> {
  return existsSync(INSTALL_BASE);
}

async function getInstalledPath(): Promise<string> {
  return INSTALL_BASE;
}

async function uninstall() {
  const installedPath = await getInstalledPath();
  if (!installedPath || !existsSync(installedPath)) return;

  write("  Uninstalling...\n");

  // If we're inside the folder we're deleting, copy to /tmp first
  if (process.execPath.startsWith(installedPath)) {
    const selfCopy = join("/tmp", `vsh-uninstall-${process.pid}`);
    const selfData = await import("node:fs/promises").then((m) => m.readFile(process.execPath));
    await writeFile(selfCopy, selfData);
    await Bun.$`chmod +x ${selfCopy}`;
    Bun.spawn([selfCopy, "--delete-path", installedPath], { detached: true }).unref();
    process.exit(0);
  }

  // We're outside the install folder (e.g., original installer binary) — delete directly
  await import("node:child_process").then(m => m.execSync(`rm -rf "${installedPath}"`, { stdio: "inherit" }));
  const desktopFile = join(homedir(), ".local", "share", "applications", "visual-studio-harness.desktop");
  try { await rm(desktopFile, { force: true }); } catch {}
  const desktopShortcut = join(homedir(), "Desktop", "visual-studio-harness.desktop");
  try { await rm(desktopShortcut, { force: true }); } catch {}
  write("  \x1B[32m✓\x1B[0m Uninstall complete.\n");
}

async function doInstall() {
  const installPath = INSTALL_BASE;
  const isUpdate = existsSync(join(installPath, "config.json"));
  await mkdir(installPath, { recursive: true });

  write("  Extracting...\n");
  const binaryData = Buffer.from(PORTABLE_BINARY_BASE64, "base64");
  const binaryPath = join(installPath, "visual-studio-harness");
  const tmpPath = join(installPath, `.visual-studio-harness.update.${process.pid}`);
  await writeFile(tmpPath, binaryData);
  await Bun.$`chmod +x ${tmpPath}`;
  try {
    await rename(tmpPath, binaryPath);
  } catch (err) {
    await rm(tmpPath, { force: true });
    throw new Error(`Failed to replace binary at ${binaryPath}: ${String(err)}`);
  }

  if (!isUpdate) {
    write("  Creating config...\n");
    await mkdir(join(installPath, "sessions"), { recursive: true });
    await mkdir(join(installPath, "logs"), { recursive: true });
    const defaultConfig = {
      providers: [{ displayName: "OpenCode Zen", baseUrl: "https://opencode.ai/zen/v1", models: [{ displayName: "Default Model", modelName: "default" }] }],
      defaultProvider: "OpenCode Zen",
      defaultModel: "Default Model",
      headless: false,
    };
    await writeFile(join(installPath, "config.json"), JSON.stringify(defaultConfig, null, 2) + "\n", "utf-8");
  }

  // Seed dev data if embedded (merge with existing on update)
  let seeded: any = { mcps: [], providers: [], agentConfigs: [], mds: [] };
  try { seeded = (await import("./generated/seeded-data")).SEEDED_DATA; } catch {}
  const configPath = join(installPath, "config.json");

  if (seeded.mcps?.length) {
    const config = JSON.parse(await readFile(configPath, "utf-8"));
    config.mcpServers = [...(config.mcpServers || []), ...seeded.mcps];
    await writeFile(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
  }
  if (seeded.providers?.length) {
    const config = JSON.parse(await readFile(configPath, "utf-8"));
    for (const p of seeded.providers) {
      const existing = config.providers.findIndex((x: any) => x.displayName === p.displayName);
      if (existing >= 0) config.providers[existing] = { ...config.providers[existing], ...p };
      else config.providers.push(p);
    }
    await writeFile(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
  }
  if (seeded.agentConfigs?.length) {
    const config = JSON.parse(await readFile(configPath, "utf-8"));
    if (!config.agents) config.agents = {};
    for (const ac of seeded.agentConfigs) {
      if (!config.agents[ac.name]) config.agents[ac.name] = ac.config;
      if (ac.agentMdContent) {
        const agentsDir = join(installPath, "mds", "agent");
        await mkdir(agentsDir, { recursive: true });
        const filename = ac.config.agentMd?.filename || `${ac.name.toLowerCase().replace(/\s+/g, "-")}.md`;
        await writeFile(join(agentsDir, filename), ac.agentMdContent, "utf-8");
      }
      if (ac.skillMdContents?.length) {
        for (const sm of ac.skillMdContents) {
          const skillPath = join(installPath, "mds", "skill");
          await mkdir(skillPath, { recursive: true });
          await writeFile(join(skillPath, sm.filename), sm.content, "utf-8");
        }
      }
    }
    await writeFile(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
  }
  if (seeded.mds?.length) {
    for (const md of seeded.mds) {
      const mdDir = join(installPath, "mds", dirname(md.filename));
      await mkdir(mdDir, { recursive: true });
      await writeFile(join(installPath, "mds", md.filename), md.content, "utf-8");
    }
  }

  write("  Copying uninstaller...\n");
  const selfPath = process.execPath;
  const uninstallPath = join(installPath, "uninstall");
  if (existsSync(selfPath) && !selfPath.includes("$bunfs")) {
    const selfData = await import("node:fs/promises").then((m) => m.readFile(selfPath));
    await writeFile(uninstallPath, selfData);
    await Bun.$`chmod +x ${uninstallPath}`;
  }

  const desktopEntry = [
    "[Desktop Entry]", "Type=Application", "Name=Visual Studio Harness",
    `Exec=${binaryPath}`, "Terminal=false", "Categories=Development;IDE;",
    "Comment=AI-powered development environment",
  ].join("\n") + "\n";

  const appsDir = join(homedir(), ".local", "share", "applications");
  await mkdir(appsDir, { recursive: true });
  await writeFile(join(appsDir, "visual-studio-harness.desktop"), desktopEntry, "utf-8");

  const desktopDir = join(homedir(), "Desktop");
  await mkdir(desktopDir, { recursive: true });
  await writeFile(join(desktopDir, "visual-studio-harness.desktop"), desktopEntry, "utf-8");
  await Bun.$`chmod +x ${join(desktopDir, "visual-studio-harness.desktop")}`;

  write(`  \x1B[32m✓\x1B[0m Installed to: ${installPath}\n`);
}

async function main() {
  // Handle --delete-path from /tmp uninstaller copy
  const deleteIdx = process.argv.indexOf("--delete-path");
  if (deleteIdx >= 0 && process.argv[deleteIdx + 1]) {
    const target = process.argv[deleteIdx + 1];
    await rm(target, { recursive: true, force: true });
    // Also clean up the desktop shortcuts
    const desktopFile = join(homedir(), ".local", "share", "applications", "visual-studio-harness.desktop");
    if (existsSync(desktopFile)) await rm(desktopFile, { force: true });
    const desktopShortcut = join(homedir(), "Desktop", "visual-studio-harness.desktop");
    if (existsSync(desktopShortcut)) await rm(desktopShortcut, { force: true });
    // Delete our own /tmp copy
    const tmpCopyPath = process.execPath;
    await rm(tmpCopyPath, { force: true });
    process.exit(0);
  }

  // Re-launch in a terminal if double-clicked (no TTY)
  if (!process.stdin.isTTY) {
    const self = process.execPath;
    try {
      Bun.spawnSync(["konsole", "--hold", "-e", "bash", "-c", `"${self}"; echo; read -s -p "Press Enter to close..."`]);
      process.exit(0);
    } catch {}
  }

  initTTY();

  let hasSeed = false;
  try { const s = (await import("./generated/seeded-data")).SEEDED_DATA; hasSeed = s.mcps?.length > 0 || s.providers?.length > 0 || s.agentConfigs?.length > 0 || s.mds?.length > 0; } catch {}

  if (await alreadyInstalled()) {
    const menuItems: { label: string; value: string }[] = [];
    if (hasSeed) menuItems.push({ label: "Update (replace binary + merge seed data)", value: "update" });
    else menuItems.push({ label: "Update (replace binary only)", value: "update" });
    menuItems.push({ label: "Uninstall", value: "uninstall" });
    menuItems.push({ label: "Exit", value: "cancel" });
    const choice = await tuiMenu("Visual Studio Harness", menuItems);
    if (choice === "update") {
      write("\x1B[2J\x1B[H");
      write("  Updating...\n");
      await doInstall();
      write("\n  \x1B[32m✓\x1B[0m Update complete.\n");
    } else if (choice === "uninstall") {
      write("\x1B[2J\x1B[H");
      await uninstall();
      process.exit(0);
    }
  } else {
    const proceed = await tuiMenu("Install Visual Studio Harness v1.0.0", [
      { label: "Install", value: "install" },
      { label: "Cancel", value: "cancel" },
    ]);
    if (proceed === "install") {
      write("\x1B[2J\x1B[H");
      write("  Installing...\n");
      await doInstall();
      write("\n  \x1B[32m✓\x1B[0m Install complete — you can launch from the application menu or desktop shortcut.\n");
    }
  }

  await pauseOnExit();
  cleanup();
}

main().catch((err) => {
  process.stdout.write(`\n\x1B[31m✗ Installer failed:\x1B[0m ${err instanceof Error ? (err.stack || err.message) : String(err)}\n`);
  process.exit(1);
});
