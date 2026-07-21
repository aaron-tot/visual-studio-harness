// ═══════════════════════════════════════════════════════════════════════════════
// GROK_EDIT_ clone of testing/tests-human/master.spec.ts
// Original file is intentionally untouched. 
// ═══════════════════════════════════════════════════════════════════════════════

import { execSync } from "child_process";
import type { Page } from "@playwright/test";
import { test, expect } from "../../fixtures";
import { setupSession, sendInitialMessage } from "../../components/setup";
import { getExpectedText } from "../../backend/src/llm/mock-models";

async function expandAllCollapsibles(page: Page): Promise<void> {
  const expandPass = async () => {
    return page.evaluate(() => {
      const msg = document.querySelector("[data-assistant-msg]");
      if (!msg) return 0;
      const buttons = msg.querySelectorAll("button[data-collapsible='true'][data-collapsible-state='closed']");
      buttons.forEach((btn) => (btn as HTMLElement).click());
      return buttons.length;
    });
  };

  await page.evaluate(() => {
    const msg = document.querySelector("[data-assistant-msg]");
    if (!msg) return;
    msg.querySelectorAll("details").forEach((d) => {
      (d as HTMLDetailsElement).open = true;
    });
  });

  await page.evaluate(() => {
    const msg = document.querySelector("[data-assistant-msg]");
    if (!msg) return;
    const brainBtn = msg.querySelector("button[title='Expand thinking']");
    if (brainBtn) (brainBtn as HTMLElement).click();
  });
  await page.waitForTimeout(200);

  for (let pass = 0; pass < 5; pass++) {
    const count = await expandPass();
    if (count === 0) break;
    await page.waitForTimeout(300);
  }
}

async function findProgressiveMatch(page: Page, expected: string): Promise<{ len: number; text: string }> {
  await expandAllCollapsibles(page);

  const normLen = expected.replace(/\s+/g, " ").trim().length;
  let normMatchLen = 0;
  const result = await page.evaluate((exp: string) => {
    const bodyNorm = document.body.innerText.replace(/\s+/g, " ").trim();
    const expNorm = exp.replace(/\s+/g, " ").trim();
    for (let len = expNorm.length; len > 0; len--) {
      const search = expNorm.slice(0, len);
      if (bodyNorm.includes(search)) {
        const pct = (len / expNorm.length * 100).toFixed(1);
        console.log(`[test] Progressive match ${pct}% (norm ${len}/${expNorm.length})`);
        return len;
      }
    }
    console.log("[test] Progressive match: no match found");
    return 0;
  }, expected);
  normMatchLen = result;

  const pct = normMatchLen / normLen;
  const mapped = Math.round(expected.length * pct);
  console.log(`Progressive match: ${(pct * 100).toFixed(1)}% (~${mapped}/${expected.length} chars)`);
  const isFull = normMatchLen >= normLen;
  return { len: isFull ? expected.length : mapped, text: isFull ? expected : expected.slice(0, mapped) };
}

/**
 * At the progressive-match boundary: 10 chars before | 10 chars after
 * for both UI body and expected. Shows *why* match stops / regressed.
 */
async function logMatchBoundary(
  page: Page,
  expected: string,
  label: string,
  reason: string,
  matchLen: number
): Promise<string> {
  await expandAllCollapsibles(page);
  const boundary = await page.evaluate((exp: string) => {
    const bodyNorm = document.body.innerText.replace(/\s+/g, " ").trim();
    const expNorm = exp.replace(/\s+/g, " ").trim();
    let bestLen = 0;
    for (let len = expNorm.length; len > 0; len--) {
      if (bodyNorm.includes(expNorm.slice(0, len))) {
        bestLen = len;
        break;
      }
    }
    const matchStart = bestLen > 0 ? bodyNorm.indexOf(expNorm.slice(0, Math.min(bestLen, 200))) : -1;
    // Prefer full-prefix search when short enough
    const fullPrefix = bestLen > 0 ? expNorm.slice(0, bestLen) : "";
    const start = fullPrefix ? bodyNorm.indexOf(fullPrefix) : matchStart;

    const expBefore = expNorm.slice(Math.max(0, bestLen - 10), bestLen);
    const expAfter = expNorm.slice(bestLen, bestLen + 10);
    const bodyBefore =
      start >= 0
        ? bodyNorm.slice(Math.max(0, start + bestLen - 10), start + bestLen)
        : "(match start not found)";
    const bodyAfter =
      start >= 0
        ? bodyNorm.slice(start + bestLen, start + bestLen + 10)
        : "(match start not found)";

    return {
      bestLen,
      expLen: expNorm.length,
      expWindow: `${JSON.stringify(expBefore)} | ${JSON.stringify(expAfter)}`,
      bodyWindow: `${JSON.stringify(bodyBefore)} | ${JSON.stringify(bodyAfter)}`,
      expBefore,
      expAfter,
      bodyBefore,
      bodyAfter,
    };
  }, expected);

  const lines = [
    `[boundary] ${label} ${reason}`,
    `  progressive match: ${boundary.bestLen}/${boundary.expLen} (mapped len≈${matchLen})`,
    `  expected  10< |>10 : ${boundary.expWindow}`,
    `  body/ui   10< |>10 : ${boundary.bodyWindow}`,
    `  expected before: ${JSON.stringify(boundary.expBefore)}`,
    `  expected after:  ${JSON.stringify(boundary.expAfter)}`,
    `  body     before: ${JSON.stringify(boundary.bodyBefore)}`,
    `  body     after:  ${JSON.stringify(boundary.bodyAfter)}`,
  ];
  const block = lines.join("\n");
  console.log(block);
  return block;
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

test("multi-session flick", async ({ page, settings, chat }) => {
  // Hard cap only; real fail path is two consecutive checks with no char growth.
  test.setTimeout(5 * 60 * 1000);
  await page.goto("/");

  // GROK_EDIT: same workspace for expected + both sessions (mirrors "mixed parts v2")
  const seedPath = timestampDir();
  const { loop, workspaceRoot } = await setupSession(page, settings, {
    agent: "Default (no system prompt)",
    model: "toolsV2",
    modelSpeed: 30,
    useCustomWorkspace: true,
    seedWorkspacePath: seedPath,
    archiveSessions: true,
  });

  const wsSnapshot = workspaceRoot + ".snap";
  execSync(`cp -r "${workspaceRoot}" "${wsSnapshot}"`, { stdio: "pipe" });
  const expected = getExpectedText("toolsV2", workspaceRoot).replace("b1 ", "\nb1 ");
  execSync(`rm -rf "${workspaceRoot}" && mv "${wsSnapshot}" "${workspaceRoot}"`, { stdio: "pipe" });
  console.log("Workspace + expected bound to: " + workspaceRoot);

  await sendInitialMessage(page, chat, "1");
  await page.waitForTimeout(3000);

  // Click "New Chat" in sidebar header
  const newBtn = page.locator("[data-testid='new-chat'], button:has-text('New Chat'), a:has-text('New Chat'), [aria-label='New chat']").first();
  if (await newBtn.isVisible().catch(() => false)) {
    await newBtn.click();
    await page.waitForTimeout(1500);
    console.log("New session created");
  } else {
    console.log("No New Chat button — trying page header click");
    await page.locator("header, nav, [data-testid='header']").first().click();
    await page.waitForTimeout(500);
  }

  await sendInitialMessage(page, chat, "2");
  await page.waitForTimeout(3000);

  let expectedBefore = "";

  /** Open auto-hide sidebar without parking on archive buttons. */
  async function openSidebar() {
    await page.mouse.move(2, 240);
    await page.waitForTimeout(350);
  }

  async function checkSession(
    label: string,
    locator: any,
    best: { v: number },
    prev: { v: number }
  ): Promise<boolean> {
    // Click the title area (left), not the row center — archive/info sit on
    // the right and used to intercept hover-clicks in headed mode.
    await locator.locator("p").first().click({ position: { x: 4, y: 4 } });
    // Leave sidebar so later actions don't keep hover on archive
    await page.mouse.move(420, 280);
    // GROK_EDIT: wait for session_state to hydrate the assistant row.
    // Rapid flicks clear messages then apply a large snapshot; a fixed 1s
    // sleep races and yields "(no msg)" even when the stream is healthy.
    await page.locator("[data-assistant-msg]").first().waitFor({
      state: "visible",
      timeout: 15000,
    });
    await page.waitForTimeout(300);

    const { before } = await page.evaluate((exp: string) => {
      const msg = document.querySelector("[data-assistant-msg]");
      if (!msg) return { before: "(no msg)" };
      const text = (msg as HTMLElement).innerText.replace(/\s+/g, " ").trim();
      const prefix = exp.replace(/\s+/g, " ").trim().slice(0, 10);
      const idx = text.indexOf(prefix);
      const before = idx > 0 ? text.slice(Math.max(0, idx - 10), idx) : "(at start)";
      return { before };
    }, expected);

    if (!expectedBefore) {
      expectedBefore = before;
      console.log(`>>>>>>> BEFORE THE START OF AGENT MESSAGE 10CHARS: ${JSON.stringify(before)}`);
    } else if (before !== expectedBefore) {
      throw new Error(
        `Before-message content changed: was ${JSON.stringify(expectedBefore)}, now ${JSON.stringify(before)}`
      );
    }

    const { len } = await findProgressiveMatch(page, expected);
    const pct = (len / expected.length * 100).toFixed(1);
    console.log(`Round ${round}: ${label} = ${pct}% (${len}/${expected.length})`);

    if (len < best.v) {
      const boundary = await logMatchBoundary(
        page,
        expected,
        label,
        `REGRESS ${best.v} → ${len}`,
        len
      );
      throw new Error(`${label} regressed from ${best.v} to ${len}\n${boundary}`);
    }
    if (len <= prev.v) {
      const { writeFileSync } = await import("fs");
      const { join } = await import("path");
      const boundary = await logMatchBoundary(
        page,
        expected,
        label,
        `STUCK at ${len}`,
        len
      );
      const rawDump = await page.evaluate((exp: string) => {
        const msg = document.querySelector("[data-assistant-msg]");
        if (!msg) return { raw: "(no [data-assistant-msg] element)", norm: "", bodyNorm: "" };
        const raw = (msg as HTMLElement).innerText;
        const norm = raw.replace(/\s+/g, " ").trim();
        const bodyNorm = document.body.innerText.replace(/\s+/g, " ").trim();
        const expNorm = exp.replace(/\s+/g, " ").trim();
        const msgs = document.querySelectorAll("[data-assistant-msg]");
        const msgCount = msgs.length;
        return { raw, norm, bodyNorm, expNorm, stuck: norm.length, msgCount };
      }, expected);
      const { raw, norm, bodyNorm, expNorm, stuck, msgCount } = rawDump;
      const lines = [
        boundary,
        `\n[data-assistant-msg] count: ${msgCount}`,
        `=== RAW innerText ===`,
        raw,
        `\n=== NORMALIZED (len=${norm.length}) ===`,
        norm,
        `\n=== EXPECTED (len=${expNorm.length}) first 200 ===`,
        expNorm.slice(0, 200),
        `\n=== expected at ${stuck} (next 100) ===`,
        expNorm.slice(stuck, stuck + 100),
        `\n=== body at ${stuck} (next 100) ===`,
        bodyNorm.slice(stuck, stuck + 100),
      ];
      const logPath = join(process.env.HOME || "/tmp", `session-stuck-${label}-r${round}.txt`);
      writeFileSync(logPath, lines.join("\n"), "utf8");
      console.log(`===== STUCK DUMP saved to ${logPath} =====`);
      throw new Error(`${label} stuck at ${len} — no progress since last check\n${boundary}`);
    }
    prev.v = len;
    if (len > best.v) best.v = len;
    return len >= expected.length;
  }

  loop.end();
  let round = 0;
  const best1 = { v: 0 }, best2 = { v: 0 };
  const prev1 = { v: -1 }, prev2 = { v: -1 };
  let done1 = false, done2 = false;

  // GROK_EDIT: toolsV2 at 30 t/s needs ~3min; 30 rounds was not enough with flick overhead
  while (round < 80 && !(done1 && done2)) {
    // Move mouse to left edge to trigger sidebar proximity, then into the sidebar
    await page.mouse.move(2, 240);
    await page.waitForTimeout(500);
    await page.mouse.move(60, 240);
    await page.waitForTimeout(200);

    if (!done1) {
      const s1 = page.locator("[data-testid='session-item']").first();
      if (await s1.isVisible().catch(() => false)) {
        done1 = await checkSession("ses1", s1, best1, prev1);
      } else {
        console.log(`Round ${round}: ses1 not visible`);
      }
    }

    if (!done2) {
      const items = page.locator("[data-testid='session-item']");
      if ((await items.count()) >= 2) {
        done2 = await checkSession("ses2", items.nth(1), best2, prev2);
      } else {
        console.log(`Round ${round}: only ${await items.count()} session(s)`);
      }
    }

    if (!(done1 && done2)) {
      await page.waitForTimeout(2000);
    }
    round++;
  }
  loop.end();
  expect(done1).toBe(true);
  expect(done2).toBe(true);
});
