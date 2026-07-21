#!/usr/bin/env bun
/**
 * Full TUI launcher — arrow-key menus, text input, yes/no, back support.
 * Outputs a JSON result to stdout for start.sh to consume.
 *
 * Usage:
 *   bun run _scripts/tui-menu.ts
 *
 * Output: { mode:"dev"|"prod"|"package", target?:string, folderName?:string, clone?:boolean, categories?:string, cloneMode?:string }
 */

import tty from "node:tty";
import { isatty } from "node:tty";
import { openSync, readFileSync, readdirSync, existsSync, appendFileSync } from "node:fs";
import { WriteStream } from "node:tty";
import { join } from "node:path";

const LOG = "/tmp/tui-debug.log";
function log(msg: string) {
  try { appendFileSync(LOG, `${new Date().toISOString()} ${msg}\n`); } catch {}
}

log("START");

const stdinFd = process.stdin.fd;
if (!isatty(stdinFd)) {
  process.stderr.write("TTY required\n");
  process.exit(1);
}
const stdin = new tty.ReadStream(stdinFd);
const ttyFd = openSync("/dev/tty", "w");
const ttyOut = new WriteStream(ttyFd);

function cleanup() {
  try { stdin.setRawMode(false); } catch {}
  stdin.destroy();
  ttyOut.destroy();
}

function clearScreen() {
  ttyOut.write("\x1B[2J\x1B[H");
}

function waitForKey() {
  return new Promise((resolve) => {
    const handler = (key) => {
      stdin.removeListener("data", handler);
      resolve(key);
    };
    stdin.on("data", handler);
  });
}

type MenuOption = { label: string; value: string };

async function tuiMenu(title: string, options: MenuOption[], opts?: { noBack?: boolean; multi?: boolean }): Promise<string | string[] | null> {
  let cursor = 0;
  const selected = opts?.multi ? new Set<number>() : undefined;
  const allOptions = [...options];
  if (!opts?.noBack) allOptions.push({ label: "← Back", value: "__back__" });

  log(`tuiMenu: title="${title}" opts=${JSON.stringify(opts)} options=${options.length}`);

  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding("utf-8");

  function render() {
    clearScreen();
    ttyOut.write(`  ${title}\n\n`);
    for (let i = 0; i < allOptions.length; i++) {
      const pointer = i === cursor ? "›" : " ";
      const check = selected?.has(i) ? "●" : selected !== undefined ? "○" : "";
      ttyOut.write(`  ${pointer} ${check ? check + " " : ""}${allOptions[i].label}\n`);
    }
    if (opts?.multi) {
      ttyOut.write("\n  ↑↓ navigate · Space toggle · Enter confirm · ← Back · Ctrl+C cancel\n");
    } else {
      ttyOut.write("\n  ↑↓ navigate · Enter select · Ctrl+C cancel\n");
    }
  }

  render();

  while (true) {
    const key = await waitForKey();
    log(`tuiMenu key: ${JSON.stringify(key)}`);
    if (key === "\x1B[A" || key === "k") {
      cursor = cursor > 0 ? cursor - 1 : allOptions.length - 1;
      render();
    } else if (key === "\x1B[B" || key === "j") {
      cursor = cursor < allOptions.length - 1 ? cursor + 1 : 0;
      render();
    } else if (key === " " && opts?.multi) {
      if (selected!.has(cursor)) selected!.delete(cursor);
      else selected!.add(cursor);
      render();
    } else if (key === "\r" || key === "\n") {
      stdin.setRawMode(false);
      const val = allOptions[cursor].value;
      log(`tuiMenu return: val="${val}"`);
      if (val === "__back__") return null;
      if (opts?.multi) {
        return [...selected!].sort((a, b) => a - b).map((i) => String(i + 1)).join(",");
      }
      return val;
    } else if (key === "\u0003") {
      cleanup();
      process.exit(0);
    }
  }
}

async function tuiInput(prompt: string, defaultValue: string): Promise<string | null> {
  stdin.setRawMode(false);
  clearScreen();
  ttyOut.write(`  ${prompt}\n\n`);
  ttyOut.write(`  [${defaultValue}]: `);

  return new Promise((resolve) => {
    const handler = (data: Buffer | string) => {
      stdin.removeListener("data", handler);
      const str = Buffer.isBuffer(data) ? data.toString() : data;
      const val = str.trim() || defaultValue;
      resolve(val);
    };
    stdin.on("data", handler);
  });
}

async function main() {
  log("main()");
  const mode = await tuiMenu("Momiji — Select Mode", [
    { label: "Dev (hot reload · ports 3001 + 5173)", value: "dev" },
    { label: "Prod (build + run single-file binary)", value: "prod" },
    { label: "Package (cross-compile binary for Linux/Windows)", value: "package" },
  ], { noBack: true });
  if (!mode) { cleanup(); process.exit(0); }
  log(`mode=${mode}`);

  if (mode === "dev") {
    clearScreen();
    ttyOut.write("  Starting in dev mode...\n");
    cleanup();
    console.log(JSON.stringify({ mode: "dev" }));
    process.exit(0);
  }

  if (mode === "package") {
    const targetResult = await tuiMenu("Select target platform", [
      { label: "Linux x86_64", value: "bun-linux-x64-modern" },
      { label: "Linux ARM64", value: "bun-linux-arm64" },
      { label: "Windows x86_64", value: "bun-windows-x64-modern" },
      { label: "Windows ARM64", value: "bun-windows-arm64" },
      { label: "All platforms", value: "all" },
    ]);
    if (targetResult === null) { log("targetResult back"); return main(); }
    log(`target=${targetResult}`);

    const typeResult = await tuiMenu("Select package type", [
      { label: "Portable (standalone binary, data lives next to it)", value: "portable" },
      { label: "Installer (embeds portable + install wizard)", value: "installer" },
    ]);
    if (typeResult === null) { log("typeResult back"); return main(); }
    log(`type=${typeResult}`);

    const seed: { mcps?: string[]; providers?: string[]; agents?: string[]; mds?: string[] } = {};

    if (typeResult === "installer") {
      const seedResult = await tuiMenu("Seed from dev data?", [
        { label: "Yes", value: "yes" },
        { label: "No", value: "no" },
      ]);
      if (seedResult === null) { log("seedResult back"); return main(); }
      log(`seedResult=${seedResult}`);

      if (seedResult === "yes") {
        const SEED_DIR = join(import.meta.dir, "..", "..", "data", "dev");
        log(`SEED_DIR=${SEED_DIR} exists=${existsSync(SEED_DIR)}`);

        if (!existsSync(SEED_DIR)) {
          ttyOut.write(`\n  Dev data not found at:\n  ${SEED_DIR}\n  Press Enter to continue...\n`);
          stdin.setRawMode(false);
          await new Promise<void>(r => stdin.once("data", () => r()));
          log("seed dir not found, continuing");
        } else {
          const configPath = join(SEED_DIR, "config.json");
          let config: any = {};
          try { config = JSON.parse(readFileSync(configPath, "utf-8")); } catch {}
          log(`config loaded: mcpServers=${config?.mcpServers?.length} providers=${config?.providers?.length}`);

          const categoriesResult = await tuiMenu("Select categories to seed (Space to toggle)", [
            { label: "MCP servers", value: "1" },
            { label: "Providers", value: "2" },
            { label: "Agents", value: "3" },
            { label: "Global MDs", value: "4" },
          ], { multi: true, noBack: true });
          log(`categoriesResult=${JSON.stringify(categoriesResult)}`);

          if (categoriesResult !== null) {
            const cats = (categoriesResult as string).split(",").map(Number);
            log(`cats=${JSON.stringify(cats)}`);

            if (cats.includes(1) && config.mcpServers) {
              const mcpItems = config.mcpServers.map((m: any) => ({ label: m.name || m.displayName || "", value: m.name || m.displayName || "" }));
              log(`mcpItems=${mcpItems.length}`);
              if (mcpItems.length > 0) {
                const picks = await tuiMenu("Select MCP servers to seed", mcpItems, { multi: true, noBack: true });
                log(`mcp picks=${JSON.stringify(picks)}`);
                if (picks !== null) {
                  const indices = (picks as string).split(",").map(Number);
                  seed.mcps = indices.map(i => mcpItems[i - 1].value);
                }
              }
            }

            if (cats.includes(2) && config.providers) {
              const provItems = config.providers.map((p: any) => ({ label: p.displayName || p.name || "", value: p.displayName || p.name || "" }));
              log(`provItems=${provItems.length}`);
              if (provItems.length > 0) {
                const picks = await tuiMenu("Select providers to seed", provItems, { multi: true, noBack: true });
                log(`prov picks=${JSON.stringify(picks)}`);
                if (picks !== null) {
                  const indices = (picks as string).split(",").map(Number);
                  seed.providers = indices.map(i => provItems[i - 1].value);
                }
              }
            }

            if (cats.includes(3)) {
              const agentNames = config.agents ? Object.keys(config.agents) : [];
              log(`agentNames=${agentNames.length} ${JSON.stringify(agentNames)}`);
              if (agentNames.length > 0) {
                const picks = await tuiMenu("Select agents to seed", agentNames.map(n => ({ label: n, value: n })), { multi: true, noBack: true });
                log(`agent picks=${JSON.stringify(picks)}`);
                if (picks !== null) {
                  const indices = (picks as string).split(",").map(Number);
                  seed.agents = indices.map(i => agentNames[i - 1]);
                }
              }
            }

            if (cats.includes(4)) {
              const mdFiles: { file: string; label: string }[] = [];
              const mdsDir = join(SEED_DIR, "mds");
              const includeMdMeta = existsSync(join(mdsDir, "mdMeta.json"));
              if (existsSync(mdsDir)) {
                const entries = readdirSync(mdsDir, { withFileTypes: true });
                for (const entry of entries) {
                  if (!entry.isDirectory() || entry.name === "agent") continue;
                  const dirPath = join(mdsDir, entry.name);
                  const files = readdirSync(dirPath).filter((f: string) => f.endsWith(".md"));
                  for (const f of files) mdFiles.push({ file: entry.name + "/" + f, label: entry.name + "/" + f });
                }
              }
              log(`mdFiles=${mdFiles.length}`);
              if (mdFiles.length > 0) {
                const picks = await tuiMenu("Select global MDs to seed", mdFiles.map(m => ({ label: m.label, value: m.file })), { multi: true, noBack: true });
                log(`md picks=${JSON.stringify(picks)}`);
                if (picks !== null) {
                  const indices = (picks as string).split(",").map(Number);
                  seed.mds = indices.map(i => mdFiles[i - 1].file);
                  if (includeMdMeta) seed.mds.push("mdMeta.json");
                }
              }
            }
          }
        }
      }
    }

    clearScreen();
    ttyOut.write("  Building binary...\n");
    log(`output seed=${JSON.stringify(seed)}`);
    cleanup();
    console.log(JSON.stringify({ mode: "package", target: targetResult, type: typeResult, seed }));
    process.exit(0);
  }

  // --- Prod flow ---

  const folderName = await tuiInput("Data folder name", "standard");
  if (folderName === null) {
    stdin.setRawMode(false);
    return main();
  }

  const cloneChoice = await tuiMenu("Clone settings from dev?", [
    { label: "Yes", value: "yes" },
    { label: "No", value: "no" },
  ]);
  if (cloneChoice === null) { return main(); }

  let categories = "";
  let cloneMode = "merge";

  if (cloneChoice === "yes") {
    ttyOut.write("  Categories to clone (comma-separated, e.g. 1,2,3,4):\n");
    ttyOut.write("    1: MCP servers  2: Providers  3: Agents  4: Global MDs\n");
    ttyOut.write("  [all]: ");
    const response = await new Promise<string>((resolve) => {
      const handler = (data: Buffer) => {
        stdin.removeListener("data", handler);
        resolve(data.toString().trim());
      };
      stdin.on("data", handler);
    });
    categories = response || "all";

    const overrideResult = await tuiMenu("Override existing data?", [
      { label: "Merge (keep existing, add new)", value: "merge" },
      { label: "Overwrite (replace all)", value: "overwrite" },
    ]);
    if (overrideResult === null) { return main(); }
    cloneMode = overrideResult as string;
  }

  clearScreen();
  ttyOut.write("  Building production binary...\n");
  ttyOut.write(`  Data: ${folderName}\n`);
  cleanup();
  log("prod flow complete");
  console.log(JSON.stringify({ mode: "prod", folderName, clone: cloneChoice === "yes", categories, cloneMode }));
  process.exit(0);
}

main().catch((e) => {
  log(`CATCH: ${e?.message || e} ${e?.stack || ""}`);
  try { ttyOut.write(`\n  \x1B[31mError: ${e?.message || e}\x1B[0m\n  Press Enter to close...`); } catch {}
  process.exit(0);
});
