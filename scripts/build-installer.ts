/**
 * Build the installer binary by embedding the portable app as base64.
 *
 * Usage:
 *   bun run scripts/build-installer.ts --target=bun-linux-x64-modern [--seed='{"mcps":[],"providers":[],"agents":[],"mds":[]}']
 *   bun run scripts/build-installer.ts --target=bun-windows-x64-modern [--seed='...']
 *
 * The installer wizard entry is chosen by target: scripts/installer-wizard.ts
 * for POSIX (linux/darwin) targets, scripts/installer-wizard-windows.ts for
 * bun-windows-* targets. They are separate, platform-specific installers.
 *
 * Output: data/package/VSH_v{version}-{target-short}-installer
 */

import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { VERSION } from "../_shared/version";

const ROOT = join(import.meta.dir, "..");
const PROJECT = join(ROOT, "..");
const PACKAGE_DIR = join(PROJECT, "data", "package");
const GENERATED_DIR = join(ROOT, "scripts", "generated");
const DEV_DATA_DIR = join(PROJECT, "data", "dev");

const targetFlag = process.argv.find(a => a.startsWith("--target="));
const target = targetFlag ? targetFlag.split("=")[1] : "bun";
const seedFlag = process.argv.find(a => a.startsWith("--seed="));
const seedArg = seedFlag ? seedFlag.split("=")[1] : "{}";
const targetShort = target === "bun" ? "" : target.replace(/^bun-/, "") + "-";

/**
 * Bun appends the executable extension automatically when compiling for a
 * foreign target (e.g. `.exe` for `bun-windows-*`), so the portable binary the
 * installer wraps is named `VSH_v{ver}-windows-x64-modern-.exe`, not the
 * extensionless name previously assumed (which made Windows installer builds
 * fail with "Portable binary not found").
 */
function exeSuffixForTarget(t: string): string {
  return t.startsWith("bun-windows") ? ".exe" : "";
}

/**
 * Map a bun target triple to the sqlite-vec platform package that provides the
 * native vector-search extension. Platform packages install as siblings of the
 * resolved `sqlite-vec` package: linux → vec0.so, windows → vec0.dll,
 * darwin → vec0.dylib. Returns null when the platform package isn't installed.
 */
function vec0LibForTarget(
  vecRoot: string,
  t: string,
): { filename: string; path: string; platform: string } | null {
  const arch = t.includes("arm64") ? "arm64" : "x64";
  let platform: string;
  let filename: string;
  if (t.startsWith("bun-windows")) {
    platform = `windows-${arch}`;
    filename = "vec0.dll";
  } else if (t.startsWith("bun-darwin")) {
    platform = `darwin-${arch}`;
    filename = "vec0.dylib";
  } else {
    platform = `linux-${arch}`;
    filename = "vec0.so";
  }
  const libPath = join(vecRoot, `sqlite-vec-${platform}`, filename);
  if (existsSync(libPath)) return { filename, path: libPath, platform };

  // Fall back to a vendored copy so cross-compiles (notably Linux→Windows) work
  // even when the foreign-platform package isn't materialized by `bun install`
  // (e.g. vendor/sqlite-vec-windows-x64/vec0.dll for bun-windows-x64 targets).
  const vendored = join(ROOT, "vendor", `sqlite-vec-${platform}`, filename);
  if (existsSync(vendored)) return { filename, path: vendored, platform };

  return null;
}

const exeSuffix = exeSuffixForTarget(target);
const portableName = `VSH_v${VERSION}-${targetShort}`;
const portablePath = join(PACKAGE_DIR, portableName + exeSuffix);

async function generateSeededData(): Promise<string> {
  let seed: any = {};
  try { seed = JSON.parse(seedArg); } catch { seed = {}; }

  const devConfigPath = join(DEV_DATA_DIR, "config.json");
  let devConfig: any = {};
  try { devConfig = JSON.parse(await readFile(devConfigPath, "utf-8")); } catch {}

  const mcps: any[] = [];
  const providers: any[] = [];
  const agentConfigs: any[] = [];
  const mds: { filename: string; content: string }[] = [];

  if (seed.mcps && Array.isArray(seed.mcps) && devConfig.mcpServers) {
    for (const selected of seed.mcps) {
      const match = devConfig.mcpServers.find(
        (m: any) => m.name === selected || m.displayName === selected || JSON.stringify(m) === JSON.stringify(selected)
      );
      if (match) mcps.push(match);
    }
  }

  if (seed.providers && Array.isArray(seed.providers) && devConfig.providers) {
    for (const selected of seed.providers) {
      const match = devConfig.providers.find((p: any) => p.displayName === selected);
      if (match) providers.push(match);
    }
  }

  if (seed.agents && Array.isArray(seed.agents) && devConfig.agents) {
    for (const agentName of seed.agents) {
      const agentCfg = devConfig.agents[agentName];
      if (!agentCfg) {
        console.warn(`Warning: Agent "${agentName}" not found in config.agents`);
        continue;
      }
      const entry: any = { name: agentName };
      const cleanConfig = { ...agentCfg };
      if (cleanConfig.agentMd) {
        const path = cleanConfig.agentMd.path;
        if (path) {
          try {
            entry.agentMdContent = await readFile(path, "utf-8");
          } catch (e) {
            console.warn(`Warning: Could not read agent MD ${path}`);
          }
        }
        cleanConfig.agentMd = { mode: cleanConfig.agentMd.mode || "inline" };
      }
      if (cleanConfig.skillMds && Array.isArray(cleanConfig.skillMds)) {
        entry.skillMdContents = [];
        cleanConfig.skillMds = cleanConfig.skillMds.map((sm: any) => ({ name: sm.name, mode: sm.mode || "inline" }));
        for (const sm of agentCfg.skillMds) {
          if (sm.path) {
            try {
              entry.skillMdContents.push({ filename: sm.name || sm.path.split("/").pop(), content: await readFile(sm.path, "utf-8") });
            } catch (e) {
              console.warn(`Warning: Could not read skill MD ${sm.path}`);
            }
          }
        }
      }
      entry.config = cleanConfig;
      agentConfigs.push(entry);
    }
  }

  if (seed.mds && Array.isArray(seed.mds)) {
    for (const mdFile of seed.mds) {
      const mdPath = join(DEV_DATA_DIR, "mds", mdFile);
      try {
        const content = await readFile(mdPath, "utf-8");
        mds.push({ filename: mdFile, content });
      } catch (e) {
        console.warn(`Warning: Could not read MD ${mdPath}`);
      }
    }
  }

  const hasData = mcps.length > 0 || providers.length > 0 || agentConfigs.length > 0 || mds.length > 0;
  if (!hasData) return "";

  const serialized = `// Generated by build-installer.ts — do not edit by hand.
// Dev data seeded by the user at packaging time.

export const SEEDED_DATA = {
  mcps: ${JSON.stringify(mcps, null, 2)},
  providers: ${JSON.stringify(providers, null, 2)},
  agentConfigs: ${JSON.stringify(agentConfigs, null, 2)},
  mds: ${JSON.stringify(mds, null, 2)},
};
`;

  const seededPath = join(GENERATED_DIR, "seeded-data.ts");
  await writeFile(seededPath, serialized, "utf-8");
  console.log(`Wrote seeded data: ${seededPath}`);
  return seededPath;
}

async function main() {
  if (!existsSync(portablePath)) {
    throw new Error(`Portable binary not found at ${portablePath}. Build portable first.`);
  }

  console.log(`Reading portable binary: ${portablePath}`);
  const portableBuf = await readFile(portablePath);
  const base64 = portableBuf.toString("base64");

  await mkdir(GENERATED_DIR, { recursive: true });

  const generatedTs = `// Generated by scripts/build-installer.ts — do not edit by hand.
// Contains the portable binary as a base64-encoded constant.

export const PORTABLE_BINARY_BASE64 = ${JSON.stringify(base64)};
export const PORTABLE_SIZE = ${portableBuf.length};
`;

  const generatedPath = join(GENERATED_DIR, "embedded-portable.ts");
  await writeFile(generatedPath, generatedTs, "utf-8");
  console.log(`Wrote embedded portable: ${generatedPath} (${(portableBuf.length / 1024 / 1024).toFixed(1)} MB)`);

  // Embed sqlite-vec native extension for install-time extraction.
  // Selected by build target so Windows installers embed vec0.dll, not the
  // Linux vec0.so that the host happens to have installed.
  const vecPkg = Bun.resolveSync("sqlite-vec/package.json", join(ROOT, "_backend", "src"));
  const vecRoot = join(dirname(vecPkg), "..");
  const vec0Lib = vec0LibForTarget(vecRoot, target);
  let vec0Embed = "";
  let vec0Filename = "vec0.so";
  if (vec0Lib) {
    const vec0Buf = await readFile(vec0Lib.path);
    vec0Embed = vec0Buf.toString("base64");
    vec0Filename = vec0Lib.filename;
    console.log(
      `Embedded ${vec0Lib.filename} (${(vec0Buf.length / 1024).toFixed(0)} KB) for ${target}`
    );
  } else if (!target.startsWith("bun-") || target.startsWith("bun-linux")) {
    throw new Error(
      `vec0 native lib not found for target "${target}" — vector search will be broken in the installer. ` +
        "Run \"bun install\" so the matching sqlite-vec platform package is available."
    );
  } else {
    console.warn(
      `WARNING: sqlite-vec native lib not found for target "${target}". ` +
        "Vector search will be DISABLED in this installer. " +
        "Install the matching platform package (e.g. \"bun add sqlite-vec-windows-x64\") to enable it."
    );
  }
  const vec0GenPath = join(GENERATED_DIR, "embedded-vec0.ts");
  await writeFile(
    vec0GenPath,
    `// Generated by scripts/build-installer.ts — do not edit by hand.

export const VEC0_SO_BASE64 = ${JSON.stringify(vec0Embed)};
export const VEC0_SO_FILENAME = ${JSON.stringify(vec0Filename)};
`,
    "utf-8"
  );

  const seedArgStr = seedArg;
  if (seedArgStr && seedArgStr !== "{}") {
    await generateSeededData();
  }

  const installerName = `VSH_v${VERSION}-${targetShort}installer`;
  const installerPath = join(PACKAGE_DIR, installerName + exeSuffix);

  if (existsSync(installerPath)) {
    await rm(installerPath, { force: true });
  }

  // Use a platform-specific installer wizard: Windows targets get a dedicated
  // Windows-native installer; all POSIX targets share the existing Linux one.
  const wizardEntry = target.startsWith("bun-windows")
    ? "installer-wizard-windows.ts"
    : "installer-wizard.ts";

  console.log(`Compiling installer (${wizardEntry}): ${installerPath}`);
  const proc = Bun.spawn(
    [
      "bun",
      "build",
      join(ROOT, "scripts", wizardEntry),
      "--compile",
      "--outfile",
      installerPath,
      "--target",
      target,
    ],
    {
      cwd: ROOT,
      stdout: "inherit",
      stderr: "inherit",
    },
  );
  const code = await proc.exited;
  if (code !== 0) {
    throw new Error(`Installer build failed (${code})`);
  }

  // Clean up generated files and intermediate base binary
  await rm(generatedPath, { force: true });
  await rm(vec0GenPath, { force: true });
  const seededPath = join(GENERATED_DIR, "seeded-data.ts");
  if (existsSync(seededPath)) await rm(seededPath, { force: true });
  if (existsSync(portablePath) && portablePath !== installerPath) {
    await rm(portablePath, { force: true });
  }

  console.log("=== Installer build complete ===");
  console.log(`Installer: ${installerPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
