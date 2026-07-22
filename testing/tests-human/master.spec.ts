import { execSync } from "child_process";
import type { Page } from "@playwright/test";
import { test, expect } from "@testing/fixtures";
import { setupSession, sendInitialMessage } from "@testing/components/setup";
import { getExpectedText } from "../../_backend/src/llm/mock-models";

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
    const stripCache = (s: string) =>
      s
        .replace(/\d+(?:\.\d+)?(?:k|M)?\s*\/\s*\d+(?:\.\d+)?(?:k|M)?\s*\(\d+(?:\.\d+)?%\)\s*cache/gi, "")
        .replace(/\s+/g, " ")
        .trim();
    const bodyNorm = stripCache(document.body.innerText);
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

async function assertCompletedToolCacheFormat(page: Page, label: string): Promise<void> {
  const sample = () => page.evaluate(() => {
    const CACHE_RE = /^\d+(?:\.\d+)?(?:k|M)?\s*\/\s*\d+(?:\.\d+)?(?:k|M)?\s*\(\d+(?:\.\d+)?%\)\s*cache$/i;
    const headers = Array.from(
      document.querySelectorAll("[data-assistant-msg] button[data-collapsible='true'][data-collapsible-level='main']")
    ) as HTMLElement[];

    const completed: Array<{ name: string; cache: string | null }> = [];
    for (const h of headers) {
      const statusEl = h.querySelector("span.uppercase") as HTMLElement | null;
      const status = (statusEl?.innerText || "").trim().toLowerCase();
      if (status !== "completed") continue;

      const spans = Array.from(h.querySelectorAll("span")) as HTMLElement[];
      const cacheSpan = spans.find((s) => /cache\s*$/i.test((s.innerText || "").trim())) || null;
      const toolName = (spans.find((s) => (s.className || "").includes("font-mono"))?.innerText || "").trim();
      completed.push({ name: toolName || "(unknown)", cache: cacheSpan ? cacheSpan.innerText.trim() : null });
    }

    const bad = completed.filter((c) => !c.cache || !CACHE_RE.test(c.cache));
    return { completedCount: completed.length, bad, all: completed };
  });

  let result = await sample();
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline && result.completedCount > 0 && result.bad.length > 0) {
    await page.waitForTimeout(250);
    result = await sample();
  }

  expect(result.completedCount, `${label}: no completed tool cards found to validate cache format`).toBeGreaterThan(0);
  expect(
    result.bad,
    `${label}: completed tools missing/invalid cache text. Expected format: "66.8k / 70.7k (94.5%) cache". Got bad=${JSON.stringify(result.bad)} all=${JSON.stringify(result.all)}`
  ).toEqual([]);
}

/**
 * At the progressive-match boundary: large windows before/after
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
  const CTX = 400;
  const boundary = await page.evaluate(
    ({ exp, ctx }: { exp: string; ctx: number }) => {
      const stripCache = (s: string) =>
        s
          .replace(/\d+(?:\.\d+)?(?:k|M)?\s*\/\s*\d+(?:\.\d+)?(?:k|M)?\s*\(\d+(?:\.\d+)?%\)\s*cache/gi, "")
          .replace(/\s+/g, " ")
          .trim();
      const bodyNorm = stripCache(document.body.innerText);
      const expNorm = exp.replace(/\s+/g, " ").trim();
      let bestLen = 0;
      for (let len = expNorm.length; len > 0; len--) {
        if (bodyNorm.includes(expNorm.slice(0, len))) {
          bestLen = len;
          break;
        }
      }
      const fullPrefix = bestLen > 0 ? expNorm.slice(0, bestLen) : "";
      const start = fullPrefix ? bodyNorm.indexOf(fullPrefix) : -1;

      const expBefore = expNorm.slice(Math.max(0, bestLen - ctx), bestLen);
      const expAfter = expNorm.slice(bestLen, bestLen + ctx);
      const bodyBefore =
        start >= 0
          ? bodyNorm.slice(Math.max(0, start + bestLen - ctx), start + bestLen)
          : "(match start not found)";
      const bodyAfter =
        start >= 0
          ? bodyNorm.slice(start + bestLen, start + bestLen + ctx)
          : "(match start not found)";

      // Also grab assistant msg full text for the fail dump
      const msg = document.querySelector("[data-assistant-msg]") as HTMLElement | null;
      const assistantNorm = msg
        ? stripCache(msg.innerText)
        : "(no [data-assistant-msg])";

      return {
        bestLen,
        expLen: expNorm.length,
        bodyLen: bodyNorm.length,
        assistantLen: assistantNorm.length,
        expBefore,
        expAfter,
        bodyBefore,
        bodyAfter,
        // last chunk of matched body + first unmatched
        matchedTail: start >= 0
          ? bodyNorm.slice(Math.max(0, start + bestLen - Math.min(ctx, bestLen)), start + bestLen)
          : "",
        assistantAround:
          assistantNorm.length > 0
            ? assistantNorm.slice(
                Math.max(0, Math.min(bestLen, assistantNorm.length) - ctx),
                Math.min(assistantNorm.length, bestLen + ctx)
              )
            : "",
      };
    },
    { exp: expected, ctx: CTX }
  );

  const lines = [
    `[boundary] ${label} ${reason}`,
    `  progressive match: ${boundary.bestLen}/${boundary.expLen} (mapped len≈${matchLen}) bodyLen=${boundary.bodyLen} assistantLen=${boundary.assistantLen}`,
    ``,
    `  === EXPECTED before boundary (${boundary.expBefore.length} chars) ===`,
    boundary.expBefore,
    ``,
    `  === EXPECTED after boundary (next ${boundary.expAfter.length} chars) ===`,
    boundary.expAfter,
    ``,
    `  === BODY/UI before boundary (${boundary.bodyBefore.length} chars) ===`,
    boundary.bodyBefore,
    ``,
    `  === BODY/UI after boundary (next ${boundary.bodyAfter.length} chars) ===`,
    boundary.bodyAfter,
    ``,
    `  === ASSISTANT MSG around boundary (±${CTX}) ===`,
    boundary.assistantAround,
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
    modelSpeed: 60,
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
      const text = (msg as HTMLElement).innerText
        .replace(/\d+(?:\.\d+)?(?:k|M)?\s*\/\s*\d+(?:\.\d+)?(?:k|M)?\s*\(\d+(?:\.\d+)?%\)\s*cache/gi, "")
        .replace(/\s+/g, " ")
        .trim();
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
        const stripCache = (s: string) =>
          s
            .replace(/\d+(?:\.\d+)?(?:k|M)?\s*\/\s*\d+(?:\.\d+)?(?:k|M)?\s*\(\d+(?:\.\d+)?%\)\s*cache/gi, "")
            .replace(/\s+/g, " ")
            .trim();
        const msg = document.querySelector("[data-assistant-msg]");
        if (!msg) return { raw: "(no [data-assistant-msg] element)", norm: "", bodyNorm: "", expNorm: "", stuck: 0, msgCount: 0 };
        const raw = (msg as HTMLElement).innerText;
        const norm = stripCache(raw);
        const bodyNorm = stripCache(document.body.innerText);
        const expNorm = exp.replace(/\s+/g, " ").trim();
        const msgs = document.querySelectorAll("[data-assistant-msg]");
        const msgCount = msgs.length;
        return { raw, norm, bodyNorm, expNorm, stuck: norm.length, msgCount };
      }, expected);
      const { raw, norm, bodyNorm, expNorm, stuck, msgCount } = rawDump;
      const around = 800;
      const lines = [
        boundary,
        `\n[data-assistant-msg] count: ${msgCount}`,
        `=== FULL ASSISTANT RAW innerText (len=${raw.length}) ===`,
        raw,
        `\n=== FULL ASSISTANT NORMALIZED (len=${norm.length}) ===`,
        norm,
        `\n=== FULL EXPECTED NORMALIZED (len=${expNorm.length}) ===`,
        expNorm,
        `\n=== expected ±${around} around stuck idx ${stuck} ===`,
        expNorm.slice(Math.max(0, stuck - around), stuck + around),
        `\n=== body ±${around} around stuck idx ${stuck} ===`,
        bodyNorm.slice(Math.max(0, stuck - around), stuck + around),
        `\n=== assistant ±${around} around stuck idx ${stuck} ===`,
        norm.slice(Math.max(0, stuck - around), stuck + around),
      ];
      const dump = lines.join("\n");
      const logPath = join(process.env.HOME || "/tmp", `session-stuck-${label}-r${round}.txt`);
      writeFileSync(logPath, dump, "utf8");
      console.log(`===== STUCK DUMP saved to ${logPath} =====`);
      // Include large boundary in the thrown error so Playwright fail output shows it
      throw new Error(`${label} stuck at ${len} — no progress since last check\n${boundary}\n\n(full dump: ${logPath})`);
    }
    prev.v = len;
    if (len > best.v) best.v = len;
    if (len >= expected.length) {
      await assertCompletedToolCacheFormat(page, `${label} round ${round}`);
    }
    return len >= expected.length;
  }

  async function assertSessionStable(
    label: string,
    locator: any,
    swapRound: number
  ): Promise<void> {
    await locator.locator("p").first().click({ position: { x: 4, y: 4 } });
    await page.mouse.move(420, 280);
    await page.locator("[data-assistant-msg]").first().waitFor({
      state: "visible",
      timeout: 15000,
    });
    await page.waitForTimeout(300);

    const { len } = await findProgressiveMatch(page, expected);
    const pct = (len / expected.length * 100).toFixed(1);
    console.log(`Post-flick ${swapRound}: ${label} = ${pct}% (${len}/${expected.length})`);

    if (len < expected.length) {
      const boundary = await logMatchBoundary(
        page,
        expected,
        label,
        `POST-FLICK MISMATCH at ${len}`,
        len
      );
      throw new Error(
        `${label} lost content after completion during post-flick round ${swapRound}\n${boundary}`
      );
    }

    await assertCompletedToolCacheFormat(page, `${label} post-flick ${swapRound}`);
  }

  // Keep CheckLoop running through the flick rounds (no_chat_error scan)
  let round = 0;
  const best1 = { v: 0 }, best2 = { v: 0 };
  const prev1 = { v: -1 }, prev2 = { v: -1 };
  let done1 = false, done2 = false;

  // Robust sidebar reveal helper
  async function revealSidebar() {
    await page.mouse.move(2, 240);
    await page.waitForTimeout(500);
    await page.mouse.move(60, 240);
    await page.waitForTimeout(300);
    // Wait for at least one session item to be visible
    await page.locator("[data-testid='session-item']").first().waitFor({ state: "visible", timeout: 5000 });
  }

  // GROK_EDIT: toolsV2 at 30 t/s needs ~3min; 30 rounds was not enough with flick overhead
  while (round < 80 && !(done1 && done2)) {
    loop.assertOk();
    await revealSidebar();

    if (!done1) {
      const s1 = page.locator("[data-testid='session-item']").first();
      if (await s1.isVisible().catch(() => false)) {
        done1 = await checkSession("ses1", s1, best1, prev1);
      } else {
        console.log(`Round ${round}: ses1 not visible`);
      }
    }

    loop.assertOk();

    if (!done2) {
      const items = page.locator("[data-testid='session-item']");
      if ((await items.count()) >= 2) {
        done2 = await checkSession("ses2", items.nth(1), best2, prev2);
      } else {
        console.log(`Round ${round}: only ${await items.count()} session(s)`);
      }
    }

    loop.assertOk();

    if (!(done1 && done2)) {
      await page.waitForTimeout(2000);
    }
    round++;
  }
  expect(done1).toBe(true);
  expect(done2).toBe(true);

  // After both sessions complete, flick back/forth 5x and verify output is retained.
  for (let postRound = 1; postRound <= 5; postRound++) {
    loop.assertOk();
    await revealSidebar();
    const itemsA = page.locator("[data-testid='session-item']");
    expect(await itemsA.count()).toBeGreaterThanOrEqual(2);
    await assertSessionStable("ses1", itemsA.first(), postRound);

    loop.assertOk();
    await revealSidebar();
    const itemsB = page.locator("[data-testid='session-item']");
    expect(await itemsB.count()).toBeGreaterThanOrEqual(2);
    await assertSessionStable("ses2", itemsB.nth(1), postRound);
  }

  loop.end();
  loop.assertOk();
});
