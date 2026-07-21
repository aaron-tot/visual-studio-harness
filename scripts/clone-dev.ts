import { readFile, writeFile, mkdir, rm, readdir, copyFile, stat } from "node:fs/promises";
import { join, dirname } from "node:path";
import { existsSync } from "node:fs";

const PROJECT = join(import.meta.dir, "../..");
const DEV_DATA = join(PROJECT, "data", "dev");

interface McpServerConfig {
  name: string;
  transport: string;
  url?: string;
  enabled?: boolean;
  headers?: Record<string, string>;
  [key: string]: unknown;
}

interface ProviderConfig {
  displayName: string;
  baseUrl: string;
  models?: Array<{ displayName: string; modelName: string; [key: string]: unknown }>;
  test?: boolean;
  [key: string]: unknown;
}

interface AgentSettings {
  providerName?: string;
  modelName?: string;
  temperature?: number;
  thinking?: { effort: "off" | "low" | "medium" | "high" };
  maxSteps?: number;
  color?: string;
  agentMd?: { mode: "existing" | "inline"; path?: string; content?: string };
  skillMds?: Array<{ mode: "existing" | "custom"; name?: string; path?: string }>;
  [key: string]: unknown;
}

interface ConfigFile {
  providers?: ProviderConfig[];
  agents?: Record<string, AgentSettings>;
  mcpServers?: McpServerConfig[];
  testModels?: Record<string, Record<string, unknown>>;
  subagent?: Record<string, unknown>;
  autoContinueOnToolEnd?: boolean;
  autoContinueOnToolEndMaxAttempts?: number;
  autoContinueOnToolEndWindowValue?: number;
  autoContinueOnToolEndWindowUnit?: string;
  autoContinueOnToolEndPrompt?: string;
  autoContinueOnThinkingEnd?: boolean;
  autoContinueOnThinkingEndMaxAttempts?: number;
  autoContinueOnThinkingEndWindowValue?: number;
  autoContinueOnThinkingEndWindowUnit?: string;
  autoContinueOnThinkingEndPrompt?: string;
  systemPromptJoiners?: Record<string, unknown>;
  snippets?: unknown[];
  defaultProvider?: string;
  defaultModel?: string;
  [key: string]: unknown;
}

function parseArgs(): { target: string; categories: number[]; mode: "override" | "merge" } {
  const args = process.argv.slice(2);
  let target = "";
  let categories: number[] = [];
  let mode: "override" | "merge" = "merge";

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--target" && i + 1 < args.length) {
      target = args[++i];
    } else if (args[i] === "--categories" && i + 1 < args.length) {
      categories = args[++i].split(",").map(Number).filter(n => n >= 1 && n <= 7);
    } else if (args[i] === "--mode" && i + 1 < args.length) {
      const m = args[++i].toLowerCase();
      if (m === "override" || m === "merge") mode = m;
    }
  }

  if (!target) throw new Error("--target <dir> is required");
  if (categories.length === 0) throw new Error("--categories <list> is required");

  if (!target.startsWith("/")) {
    target = join(PROJECT, target);
  }

  return { target, categories, mode };
}

async function readJson<T>(filePath: string): Promise<T | null> {
  try {
    const content = await readFile(filePath, "utf-8");
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

async function writeJson(filePath: string, data: unknown): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

async function copyDir(src: string, dest: string): Promise<void> {
  await mkdir(dest, { recursive: true });
  const entries = await readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else {
      await mkdir(dirname(destPath), { recursive: true });
      await copyFile(srcPath, destPath);
    }
  }
}

async function mergeDir(src: string, dest: string): Promise<void> {
  await mkdir(dest, { recursive: true });
  const entries = await readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);
    if (entry.isDirectory()) {
      await mergeDir(srcPath, destPath);
    } else {
      await mkdir(dirname(destPath), { recursive: true });
      await copyFile(srcPath, destPath);
    }
  }
}

async function cloneMcpServers(
  devConfig: ConfigFile,
  targetConfig: ConfigFile,
  _targetDir: string,
  mode: "override" | "merge",
): Promise<ConfigFile> {
  const devServers = devConfig.mcpServers || [];
  if (mode === "override") {
    targetConfig.mcpServers = JSON.parse(JSON.stringify(devServers));
  } else {
    const existing = targetConfig.mcpServers || [];
    const map = new Map<string, McpServerConfig>();
    for (const s of existing) map.set(s.name, s);
    for (const s of devServers) {
      map.set(s.name, JSON.parse(JSON.stringify(s)));
    }
    targetConfig.mcpServers = Array.from(map.values());
  }
  return targetConfig;
}

function rewriteAgentPaths(agent: AgentSettings, targetDir: string): void {
  if (agent.agentMd?.path) {
    agent.agentMd.path = agent.agentMd.path.replace(DEV_DATA, targetDir);
  }
  if (agent.skillMds) {
    for (const skill of agent.skillMds) {
      if (skill.path) {
        skill.path = skill.path.replace(DEV_DATA, targetDir);
      }
    }
  }
}

async function cloneAgents(
  devConfig: ConfigFile,
  targetConfig: ConfigFile,
  targetDir: string,
  mode: "override" | "merge",
): Promise<ConfigFile> {
  const devAgents = devConfig.agents || {};
  const devAgentsDir = join(DEV_DATA, "agents");
  const targetAgentsDir = join(targetDir, "agents");

  if (!existsSync(devAgentsDir)) {
    await mkdir(targetAgentsDir, { recursive: true });
    return targetConfig;
  }

  if (mode === "override") {
    await rm(targetAgentsDir, { recursive: true, force: true });
    await copyDir(devAgentsDir, targetAgentsDir);

    const result: Record<string, AgentSettings> = {};
    for (const [name, agent] of Object.entries(devAgents)) {
      const cloned = JSON.parse(JSON.stringify(agent)) as AgentSettings;
      rewriteAgentPaths(cloned, targetDir);
      result[name] = cloned;
    }
    targetConfig.agents = result;
  } else {
    await mkdir(targetAgentsDir, { recursive: true });
    await mergeDir(devAgentsDir, targetAgentsDir);

    if (!targetConfig.agents) targetConfig.agents = {};
    for (const [name, agent] of Object.entries(devAgents)) {
      const cloned = JSON.parse(JSON.stringify(agent)) as AgentSettings;
      rewriteAgentPaths(cloned, targetDir);
      targetConfig.agents[name] = cloned;
    }
  }
  return targetConfig;
}

async function clonePlans(
  _devConfig: ConfigFile,
  targetConfig: ConfigFile,
  targetDir: string,
  mode: "override" | "merge",
): Promise<ConfigFile> {
  const devPlansDir = join(DEV_DATA, "plans");
  const targetPlansDir = join(targetDir, "plans");

  if (!existsSync(devPlansDir)) {
    await mkdir(targetPlansDir, { recursive: true });
    return targetConfig;
  }

  if (mode === "override") {
    await rm(targetPlansDir, { recursive: true, force: true });
    await copyDir(devPlansDir, targetPlansDir);
  } else {
    await mergeDir(devPlansDir, targetPlansDir);
  }
  return targetConfig;
}

async function cloneMds(
  _devConfig: ConfigFile,
  targetConfig: ConfigFile,
  targetDir: string,
  mode: "override" | "merge",
): Promise<ConfigFile> {
  const devMdsDir = join(DEV_DATA, "mds");
  const targetMdsDir = join(targetDir, "mds");

  if (!existsSync(devMdsDir)) {
    await mkdir(targetMdsDir, { recursive: true });
    return targetConfig;
  }

  if (mode === "override") {
    await rm(targetMdsDir, { recursive: true, force: true });
    await copyDir(devMdsDir, targetMdsDir);
  } else {
    await mergeDir(devMdsDir, targetMdsDir);
  }
  return targetConfig;
}

async function cloneSettings(
  devConfig: ConfigFile,
  targetConfig: ConfigFile,
  targetDir: string,
  mode: "override" | "merge",
): Promise<ConfigFile> {
  const devGlobalPerms = join(DEV_DATA, "globalPerms.json");
  const targetGlobalPerms = join(targetDir, "globalPerms.json");
  const devToolsPerms = join(DEV_DATA, "tools.perms.json");
  const targetToolsPerms = join(targetDir, "tools.perms.json");

  const tweakFields = [
    "subagent", "autoContinueOnToolEnd", "autoContinueOnToolEndMaxAttempts",
    "autoContinueOnToolEndWindowValue", "autoContinueOnToolEndWindowUnit",
    "autoContinueOnToolEndPrompt", "autoContinueOnThinkingEnd",
    "autoContinueOnThinkingEndMaxAttempts", "autoContinueOnThinkingEndWindowValue",
    "autoContinueOnThinkingEndWindowUnit", "autoContinueOnThinkingEndPrompt",
    "systemPromptJoiners", "snippets", "defaultProvider", "defaultModel",
  ] as const;

  if (mode === "override") {
    if (existsSync(devGlobalPerms)) {
      const content = await readFile(devGlobalPerms, "utf-8");
      await mkdir(dirname(targetGlobalPerms), { recursive: true });
      await writeFile(targetGlobalPerms, content, "utf-8");
    }
    if (existsSync(devToolsPerms)) {
      const content = await readFile(devToolsPerms, "utf-8");
      await mkdir(dirname(targetToolsPerms), { recursive: true });
      await writeFile(targetToolsPerms, content, "utf-8");
    }

    for (const field of tweakFields) {
      if (field in devConfig) {
        (targetConfig as Record<string, unknown>)[field] = JSON.parse(
          JSON.stringify((devConfig as Record<string, unknown>)[field]),
        );
      }
    }
  } else {
    if (existsSync(devGlobalPerms)) {
      const dev = await readJson<Record<string, unknown>>(devGlobalPerms);
      const target = await readJson<Record<string, unknown>>(targetGlobalPerms);
      await writeJson(targetGlobalPerms, { ...(target || {}), ...(dev || {}) });
    }
    if (existsSync(devToolsPerms)) {
      const dev = await readJson<Record<string, unknown>>(devToolsPerms);
      const target = await readJson<Record<string, unknown>>(targetToolsPerms);
      await writeJson(targetToolsPerms, { ...(target || {}), ...(dev || {}) });
    }

    for (const field of tweakFields) {
      if (field in devConfig) {
        (targetConfig as Record<string, unknown>)[field] = JSON.parse(
          JSON.stringify((devConfig as Record<string, unknown>)[field]),
        );
      }
    }
  }
  return targetConfig;
}

async function cloneProviders(
  devConfig: ConfigFile,
  targetConfig: ConfigFile,
  _targetDir: string,
  mode: "override" | "merge",
  includeTests: boolean,
): Promise<ConfigFile> {
  const devProviders = (devConfig.providers || []).filter(p => includeTests || !p.test);
  const devTestModels = devConfig.testModels || {};

  if (mode === "override") {
    targetConfig.providers = JSON.parse(JSON.stringify(devProviders));
    targetConfig.testModels = includeTests
      ? JSON.parse(JSON.stringify(devTestModels))
      : {};
  } else {
    const existing = targetConfig.providers || [];
    const map = new Map<string, ProviderConfig>();
    for (const p of existing) map.set(p.displayName, p);
    for (const p of devProviders) {
      map.set(p.displayName, JSON.parse(JSON.stringify(p)));
    }
    targetConfig.providers = Array.from(map.values());

    if (includeTests) {
      const existingTestModels = targetConfig.testModels || {};
      targetConfig.testModels = { ...existingTestModels, ...devTestModels };
    } else {
      targetConfig.testModels = {};
    }
  }
  return targetConfig;
}

async function main() {
  const { target, categories, mode } = parseArgs();

  const devConfigPath = join(DEV_DATA, "config.json");
  const devConfig = await readJson<ConfigFile>(devConfigPath);
  if (!devConfig) {
    console.error(`Dev config not found: ${devConfigPath}`);
    process.exit(1);
  }

  const targetConfigPath = join(target, "config.json");
  let targetConfig = (await readJson<ConfigFile>(targetConfigPath)) || ({} as ConfigFile);

  console.log(`Mode: ${mode}`);

  for (const cat of categories.sort()) {
    switch (cat) {
      case 1: {
        console.log("  [1] Cloning MCP servers...");
        targetConfig = await cloneMcpServers(devConfig, targetConfig, target, mode);
        break;
      }
      case 2: {
        console.log("  [2] Cloning Agents...");
        targetConfig = await cloneAgents(devConfig, targetConfig, target, mode);
        break;
      }
      case 3: {
        console.log("  [3] Cloning Plans...");
        targetConfig = await clonePlans(devConfig, targetConfig, target, mode);
        break;
      }
      case 4: {
        console.log("  [4] Cloning MDs...");
        targetConfig = await cloneMds(devConfig, targetConfig, target, mode);
        break;
      }
      case 5: {
        console.log("  [5] Cloning Settings...");
        targetConfig = await cloneSettings(devConfig, targetConfig, target, mode);
        break;
      }
      case 6: {
        console.log("  [6] Cloning Providers (no tests)...");
        targetConfig = await cloneProviders(devConfig, targetConfig, target, mode, false);
        break;
      }
      case 7: {
        console.log("  [7] Cloning Providers (with tests)...");
        targetConfig = await cloneProviders(devConfig, targetConfig, target, mode, true);
        break;
      }
    }
  }

  await writeJson(targetConfigPath, targetConfig);
  console.log("\nClone complete.");
}

main().catch((err) => {
  console.error("Clone failed:", err);
  process.exit(1);
});
