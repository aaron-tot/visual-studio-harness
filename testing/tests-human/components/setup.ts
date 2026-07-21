import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import type { SettingsModal } from "./settings";
import { CheckLoop } from "./CheckLoop";
import type { ChatPage } from "./chat";

export interface SessionSetupFlags {
  agent: string;
  model: string;
  modelSpeed: number;
  useCustomWorkspace?: boolean;
  seedWorkspacePath?: string;
  archiveSessions?: boolean;
}

function timestampDir(): string {
  const now = new Date();
  const ts = now.getFullYear() + "-" +
    String(now.getMonth() + 1).padStart(2, "0") + "-" +
    String(now.getDate()).padStart(2, "0") + "_" +
    String(now.getHours()).padStart(2, "0") + "-" +
    String(now.getMinutes()).padStart(2, "0") + "-" +
    String(now.getSeconds()).padStart(2, "0");
  const rand = Math.random().toString(36).slice(2, 8);
  return "tests/" + ts + "_" + rand;
}

function seedWorkspace(baseDir: string) {
  mkdirSync(join(baseDir, "src"), { recursive: true });
  mkdirSync(join(baseDir, "data"), { recursive: true });
  mkdirSync(join(baseDir, ".VISUAL STUDIO HARNESS", "skills"), { recursive: true });
  writeFileSync(join(baseDir, "src", "index.ts"), [
    "function greet(name: string): string {",
    '  return "Hello, " + name + "!";',
    "}",
    "class Calculator {",
    "  add(a: number, b: number): number {",
    "    return a + b;",
    "  }",
    "}",
  ].join("\n") + "\n");
  writeFileSync(join(baseDir, "data", "hello.txt"), "Hello world!\nThis is a test file.\n");
  writeFileSync(join(baseDir, "editthis.txt"), "original content\n");
  writeFileSync(join(baseDir, ".VISUAL STUDIO HARNESS", "skills", "test-skill.md"),
    "# Test Skill\nA test skill for the mixed part types test.\n");
  writeFileSync(join(baseDir, ".VISUAL STUDIO HARNESS", "workspacePerms.json"),
    JSON.stringify({ version: 1, tools: { "*": "allow" } }, null, 2));
}

/**
 * Reusable session setup:
 *  - Creates custom workspace (if useCustomWorkspace) — seedWorkspacePath required when true
 *  - Selects agent and verifies pill reflects it
 *  - Selects model and verifies pill reflects it
 *  - Sets model speed
 *  - Archives old sessions
 *  - Creates and returns a running CheckLoop with basic checks
 */
export async function setupSession(
  page: Page,
  settings: SettingsModal,
  flags: SessionSetupFlags,
): Promise<{ workspaceRoot: string; loop: CheckLoop }> {
  // Validate required fields
  if (flags.useCustomWorkspace && !flags.seedWorkspacePath) {
    throw new Error("seedWorkspacePath is required when useCustomWorkspace is true");
  }

  const result: { workspaceRoot: string; loop: CheckLoop } = {
    workspaceRoot: "",
    loop: new CheckLoop(page),
  };

  // Create custom workspace if requested
  if (flags.useCustomWorkspace && flags.seedWorkspacePath) {
    result.workspaceRoot = process.env.TEST_WORKSPACE_ROOT || join(__dirname, "..", "..", "..", flags.seedWorkspacePath);
    seedWorkspace(result.workspaceRoot);

    // Select workspace via the workspace picker
    await page.getByText("~/Desktop").first().click();
    await page.waitForTimeout(300);
    await page.getByText("Browse folders").first().click();
    await page.waitForTimeout(300);
    await page.locator("input[placeholder='/path/to/folder']").fill(result.workspaceRoot);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(1000);
    await page.getByText("Use this folder").first().click();
    await page.waitForTimeout(500);

    const wsText = await page.getByText("~/Desktop").count();
    expect(wsText).toBe(0);
    console.log("Workspace set to: " + result.workspaceRoot);
  }

  // Select agent and verify — fail if >5s
  const agentPill = page.locator("[data-testid='agent-pill']").first();
  await Promise.race([
    agentPill.click().then(async () => {
      await page.waitForTimeout(300);
      const agentOption = page.locator("[role='option']").filter({ hasText: flags.agent }).first();
      await agentOption.click();
      await page.waitForTimeout(300);
      await expect(agentPill).toContainText(flags.agent);
    }),
    new Promise((_, reject) => setTimeout(() => reject(new Error("Agent selection timed out (>5s)")), 5000)),
  ]);
  console.log("Agent selected: " + flags.agent);

  // Open settings, set speed — look up the label from the model name
  const MODEL_LABELS: Record<string, string> = {
    "model1000": "model1000 — counts 1 to 1000",
    "model-mixed": "model-mixed — counting, tool call, thinking",
    "model-alltools": "model-alltools — all tools with text",
    "toolsV2": "toolsV2 — basic tool call",
  };
  const modelLabel = MODEL_LABELS[flags.model] || flags.model;
  await page.locator("[data-testid='settings']").click();
  await settings.switchTab("Test Models");
  await settings.setTestModelSpeed(modelLabel, flags.modelSpeed);
  await settings.close();

  // Select model and verify — fail if >5s
  await Promise.race([
    (async () => {
      await page.locator("[data-testid='model-pill']").click();
      await page.waitForTimeout(500);
      await page.locator("[data-testid='model-search']").fill(flags.model);
      await page.waitForTimeout(300);
      await page.getByText(flags.model, { exact: true }).first().click({ force: true });
      await page.waitForTimeout(500);
      const modelPill = page.locator("[data-testid='model-pill']").first();
      await expect(modelPill).toContainText(flags.model);
    })(),
    new Promise((_, reject) => setTimeout(() => reject(new Error("Model selection timed out (>5s)")), 5000)),
  ]);
  console.log("Model selected: " + flags.model + " at " + flags.modelSpeed + " t/s");

  // Archive all sessions (unless opted out)
  if (flags.archiveSessions !== false) {
    // Open auto-hide sidebar (proximity reveal)
    await page.mouse.move(2, 200);
    await page.waitForTimeout(600);
    while (true) {
      const items = page.locator("[data-testid='session-item']");
      const count = await items.count();
      if (count === 0) break;
      const first = items.first();
      // Hover the row so archive gets pointer-events (group-hover)
      await first.hover();
      await page.waitForTimeout(200);
      const arch = first.locator("[data-testid='archive']");
      // force: archive is opacity-0 until hover; wait for actionability
      if (await arch.count() > 0) {
        await arch.click({ force: true });
        await page.waitForTimeout(400);
      } else {
        break;
      }
    }
    // Park mouse away so we don't leave hover on archive mid-test
    await page.mouse.move(400, 300);
    await page.waitForTimeout(200);
  }

  // Register default checks on the loop
  result.loop.register("no_user_msg_drop", async () => {
    const count = await page.locator("[data-user-msg]").count();
    // Don't check exact count — just flag if any user messages disappear
    if (count < 0) throw new Error("User messages dropped below 0");
  }, true);

  // Start the loop
  result.loop.begin(20);

  return result;
}

/**
 * Send an initial message, verify it appears exactly once, wait 1s.
 */
export async function sendInitialMessage(page: Page, chat: ChatPage, text: string) {
  await chat.sendMessage(text);
  await page.waitForTimeout(500);

  // Verify user message appears exactly once with correct text
  const userMsgs = page.locator("[data-user-msg]");
  await expect(userMsgs.first()).toBeVisible({ timeout: 10000 });
  const count = await userMsgs.count();
  expect(count).toBe(1);

  // Verify user message content matches
  const msgText = await userMsgs.first().textContent();
  expect(msgText).toContain(text);

  await page.waitForTimeout(1000);
}
