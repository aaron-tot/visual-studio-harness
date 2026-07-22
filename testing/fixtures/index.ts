import { test as base, type Page } from "@playwright/test";
import { Header } from "../components/header";
import { SidePanel } from "../components/sidebar";
import { ChatPage } from "../components/chat";
import { SettingsModal } from "../components/settings";

type Components = {
  header: Header;
  sidebar: SidePanel;
  chat: ChatPage;
  settings: SettingsModal;
};

export const test = base.extend<Components>({
  header: async ({ page }, use) => use(new Header(page)),
  sidebar: async ({ page }, use) => use(new SidePanel(page)),
  chat: async ({ page }, use) => use(new ChatPage(page)),
  settings: async ({ page }, use) => use(new SettingsModal(page)),
});

/** 5 fire console logs + thin top bar countdown (pause/unpause) before test ends. */
async function failureHold(page: Page, reason: string) {
  try {
    for (let i = 0; i < 5; i++) {
      await page.evaluate((n) => {
        console.log(`🔥🔥🔥🔥🔥 FAILED TEST FIRE ${n}/5 🔥🔥🔥🔥🔥`);
      }, i + 1);
      console.log(`🔥🔥🔥🔥🔥 FAILED TEST FIRE ${i + 1}/5 🔥🔥🔥🔥🔥`);
    }

    await page.evaluate((reasonText) => {
      const old = document.getElementById("__test-fail-overlay");
      if (old) old.remove();
      const el = document.createElement("div");
      el.id = "__test-fail-overlay";
      el.style.cssText = [
        "position:fixed",
        "top:0",
        "left:0",
        "right:0",
        "height:32px",
        "z-index:2147483647",
        "display:flex",
        "align-items:center",
        "gap:10px",
        "background:#7f1d1d",
        "color:#fff",
        "font:600 12px/1 system-ui,sans-serif",
        "padding:0 10px",
        "box-sizing:border-box",
        "pointer-events:auto",
        "border-bottom:1px solid #fca5a5",
      ].join(";");
      el.innerHTML = `
        <span style="flex:0 0 auto">🔥 FAIL</span>
        <span id="__test-fail-reason" style="flex:1 1 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;opacity:0.9;font-weight:500"></span>
        <span style="flex:0 0 auto">ending in <b id="__test-fail-count">10</b>s</span>
        <button id="__test-fail-pause" type="button" style="
          flex:0 0 auto;height:22px;padding:0 10px;border:1px solid #fecaca;border-radius:4px;
          background:#450a0a;color:#fff;font:600 11px system-ui,sans-serif;cursor:pointer;
        ">Pause</button>
      `;
      document.body.appendChild(el);
      const r = document.getElementById("__test-fail-reason");
      if (r) r.textContent = reasonText;

      (window as any).__testFailPaused = false;
      const btn = document.getElementById("__test-fail-pause") as HTMLButtonElement | null;
      if (btn) {
        btn.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          (window as any).__testFailPaused = !(window as any).__testFailPaused;
          const paused = !!(window as any).__testFailPaused;
          btn.textContent = paused ? "Unpause" : "Pause";
          btn.style.background = paused ? "#14532d" : "#450a0a";
          btn.style.borderColor = paused ? "#86efac" : "#fecaca";
          console.log(paused ? "🔥 COUNTDOWN PAUSED 🔥" : "🔥 COUNTDOWN UNPAUSED 🔥");
        });
      }
    }, reason);

    // Count down 10 → 1; pause freezes while button toggled
    let remaining = 10;
    while (remaining > 0) {
      const paused = await page.evaluate(() => !!(window as any).__testFailPaused).catch(() => false);
      if (paused) {
        console.log(`!!! FAILED TEST: PAUSED (at ${remaining}s) !!!`);
        await page.waitForTimeout(250);
        continue;
      }
      await page.evaluate((n) => {
        const c = document.getElementById("__test-fail-count");
        if (c) c.textContent = String(n);
        console.log(`🔥 FAILED TEST: ENDING IN ${n} SECONDS 🔥`);
      }, remaining);
      console.log(`!!! FAILED TEST: ENDING TEST IN ${remaining} SECONDS !!!`);
      await page.waitForTimeout(1000);
      remaining -= 1;
    }
  } catch (e) {
    console.log(`[failureHold] page hold failed: ${e}`);
    for (let i = 10; i > 0; i--) {
      console.log(`!!! FAILED TEST: ENDING TEST IN ${i} SECONDS !!!`);
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

// Automatically fail test on React render errors or console errors
test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      const text = msg.text();
      if (text.includes("MESSAGE_ROW_RENDER_ERROR") ||
          text.includes("RENDER_ERROR") ||
          text.includes("Error:") ||
          text.includes("Uncaught")) {
        errors.push(text);
      }
    }
  });

  // Store errors on page for afterEach check
  (page as any).__testErrors = errors;
});

test.afterEach(async ({ page }, testInfo) => {
  const errors = (page as any).__testErrors || [];
  const failedByStatus = testInfo.status !== testInfo.expectedStatus;
  const failedByConsole = errors.length > 0 && !failedByStatus;

  if (!failedByStatus && !failedByConsole) return;

  const reason = failedByConsole
    ? `React/Console errors (${errors.length})`
    : `Test failed: ${testInfo.title} (${testInfo.status})`;

  console.log(`[FAILURE CAPTURE] ${reason}`);

  try {
    const sessionId = await page.locator("[data-testid='session-id']").first().textContent({ timeout: 2000 }).catch(() => "N/A");
    console.log(`[FAILURE CAPTURE] Session ID: ${sessionId?.trim() || "N/A"}`);

    const messages = await page.locator("[data-assistant-msg]").all();
    console.log(`[FAILURE CAPTURE] Assistant messages count: ${messages.length}`);

    for (let i = 0; i < messages.length; i++) {
      const text = await messages[i].textContent().catch(() => "(unreadable)");
      const truncated = text ? text.replace(/\s+/g, " ").trim().slice(0, 500) : "(empty)";
      console.log(`[FAILURE CAPTURE] Msg ${i + 1}: ${truncated}${text && text.length > 500 ? "..." : ""}`);
    }

    const userMsgs = await page.locator("[data-user-msg]").all();
    console.log(`[FAILURE CAPTURE] User messages count: ${userMsgs.length}`);
    for (let i = 0; i < userMsgs.length; i++) {
      const text = await userMsgs[i].textContent().catch(() => "(unreadable)");
      console.log(`[FAILURE CAPTURE] User ${i + 1}: ${text?.replace(/\s+/g, " ").trim().slice(0, 200)}`);
    }

    const sessionItems = await page.locator("[data-testid='session-item']").all();
    console.log(`[FAILURE CAPTURE] Session items count: ${sessionItems.length}`);
    for (let i = 0; i < sessionItems.length; i++) {
      const title = await sessionItems[i].locator("p").first().textContent().catch(() => "(unreadable)");
      const sessionIdAttr = await sessionItems[i].getAttribute("data-session-id").catch(() => null);
      console.log(`[FAILURE CAPTURE] Session ${i + 1}: "${title?.trim()}" (id: ${sessionIdAttr || "N/A"})`);
    }

    if (errors.length > 0) {
      console.log(`[FAILURE CAPTURE] React/Console errors: ${errors.length}`);
      errors.forEach((e: string, i: number) => console.log(`  [${i}] ${e}`));
    }
  } catch (e) {
    console.log(`[FAILURE CAPTURE] Error during capture: ${e}`);
  }

  await failureHold(page, reason);

  if (failedByConsole) {
    throw new Error(`React/Console errors detected during test:\n${errors.join("\n")}`);
  }
});

export { expect } from "@playwright/test";

export function wait(page: Page, ms?: number) {
  const timeout = ms ?? (process.env.WAIT ? Number(process.env.WAIT) : 2000);
  if (timeout <= 0) return Promise.resolve();
  return page.waitForTimeout(timeout);
}
