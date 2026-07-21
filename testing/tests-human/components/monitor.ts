import type { Page } from "@playwright/test";

type MonitorResult = {
  expectedUser: number;
  expectedAssistant: number;
  actualUser: number;
  actualAssistant: number;
  assistantText: string;
};

export class MessageMonitor {
  private page: Page;
  private expectedUser = 0;
  private expectedAssistant = 0;
  private failures: string[] = [];
  private running = false;
  private interval: ReturnType<typeof setInterval> | null = null;
  private debugDetail = "";
  private expectedTextContent = "";
  private onesCheckRunning = false;
  private onesInterval: ReturnType<typeof setInterval> | null = null;
  private lastOnesContext = "";

  constructor(page: Page) {
    this.page = page;
  }

  reset() {
    this.expectedUser = 0;
    this.expectedAssistant = 0;
    this.failures = [];
  }

  expectUserMessages(n: number) {
    this.expectedUser = n;
    this.failures = [];
  }

  expectAssistantMessages(n: number) {
    this.expectedAssistant = n;
    this.failures = [];
  }

  expectMessages(user: number, assistant: number) {
    this.expectedUser = user;
    this.expectedAssistant = assistant;
    this.failures = [];
  }

  expectAssistantTextContains(text: string) {
    this.expectedTextContent = text;
  }

  private debugDetail: string = "";

  // During continuous 50ms polling, only flag message DISAPPEARANCES (drops).
  // Exact count matching (duplicate detection) happens in check().
  onResult(result: MonitorResult) {
    if (result.actualUser < result.expectedUser) {
      this.failures.push(
        `User messages dropped: expected >= ${result.expectedUser}, got ${result.actualUser}`
      );
    }
    if (result.actualAssistant < result.expectedAssistant) {
      this.failures.push(
        `Assistant messages dropped: expected >= ${result.expectedAssistant}, got ${result.actualAssistant} (${this.debugDetail})`
      );
    }
    if (this.expectedTextContent && !result.assistantText.includes(this.expectedTextContent)) {
      this.failures.push(
        `Assistant text missing expected content "${this.expectedTextContent}"`
      );
    }
  }

  async start() {
    this.running = true;
    const poll = async () => {
      if (!this.running) return;
      try {
        const actualUser = await this.page.locator("[data-user-msg]").count();
        const { count: actualAssistant, detail: debugDetail, text: assistantText } = await this.page.evaluate(() => {
          const scroll = document.querySelector("[data-scroll]");
          if (!scroll) return { count: 0, detail: "no-scroll", text: "" };
          const detail: string[] = [];
          const children = Array.from(scroll.children);
          for (const c of children) {
            const cls = c.className || "";
            const tag = c.tagName;
            const txt = (c.textContent || "").substring(0, 40);
            const hasUM = c.querySelector("[data-user-msg]") ? "Y" : "N";
            const ch = c.children.length;
            const ai = c.classList.contains("animate-in") ? "Y" : "N";
            detail.push(`${tag}.${cls.substring(0,15)} ch=${ch} ai=${ai} um=${hasUM} txt="${txt}"`);
          }
          const wrappers = scroll.querySelectorAll(".animate-in");
          let count = 0;
          for (const w of wrappers) {
            if (!w.querySelector("[data-user-msg]")) count++;
          }
          for (const c of children) {
            if (c.classList.contains("animate-in")) continue;
            if (c.children.length === 0) continue;
            if (c.querySelector(".animate-in")) continue;
            if (c.querySelector("[data-user-msg]")) continue;
            if (c.textContent?.includes("Thinking")) continue;
            if (c.classList.contains("sticky")) continue;
            if (c.tagName !== "DIV") continue;
            count++;
          }
          const assistantText = (scroll.textContent || "").trim();
          return { count, detail: detail.join(" | "), text: assistantText };
        });
        this.debugDetail = debugDetail;
        const r: MonitorResult = {
          expectedUser: this.expectedUser,
          expectedAssistant: this.expectedAssistant,
          actualUser,
          actualAssistant,
          assistantText,
        };
        this.onResult(r);
      } catch {
        // page might be navigating, ignore transient failures
      }
    };
    // do an immediate check, then start interval
    await poll();
    this.interval = setInterval(poll, 50);
  }

  stop() {
    this.running = false;
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  // Surface any polling failures (message drops) without exact checking.
  // Used inside wait functions during streaming where exact counts aren't known yet.
  checkDrops() {
    if (this.failures.length > 0) {
      const msg = this.failures.join("; ");
      this.failures = [];
      throw new Error(`MessageMonitor: ${msg}`);
    }
  }

  // onesCheck: polls every 50ms that the main assistant text paragraph
  // (starts with digits, >10 chars) starts with the expected label.
  // Checks the first 60 chars of the paragraph for the label.
  // Ignores individual part elements (<p> with just "1", " 2", etc).
  startOnesCheck(label: string) {
    this.onesCheckRunning = true;
    const poll = async () => {
      if (!this.onesCheckRunning) return;
      try {
        const result = await this.page.evaluate((lbl) => {
          const scroll = document.querySelector("[data-scroll]");
          if (!scroll) return { found: false, context: "no-scroll" };
          const paras = scroll.querySelectorAll("p");
          let best: string | null = null;
          let bestLen = 0;
          for (const p of paras) {
            const text = p.textContent || "";
            const trimmed = text.trim();
            if (!/^\d/.test(trimmed)) continue;
            const len = trimmed.length;
            if (len <= 10) continue;
            const start = trimmed.substring(0, 60);
            if (start.includes(lbl) && len > bestLen) {
              best = start;
              bestLen = len;
            }
          }
          return best ? { found: true, context: best } : { found: false, context: "not found in main paragraph start" };
        }, label);
        if (!result.found) {
          this.failures.push(`onesCheck: "${label}" not found at start of main assistant text [${result.context}]`);
        } else if (!result.context.startsWith(label)) {
          this.failures.push(`onesCheck: "${label}" missing from start of paragraph — starts with: "${result.context}"`);
        } else {
          process.stdout.write(`[onesCheck] "${label}" OK — paragraph starts: "${result.context}"\n`);
        }
      } catch {
        // page might be navigating, ignore transient failures
      }
    };
    poll();
    this.onesInterval = setInterval(poll, 50);
  }

  stopOnesCheck() {
    this.onesCheckRunning = false;
    if (this.onesInterval) {
      clearInterval(this.onesInterval);
      this.onesInterval = null;
    }
  }

  // Full verification: drops + exact-match count check.
  // Used when the test expects concrete counts (e.g., after stream completes).
  async check() {
    this.checkDrops();
    const actualUser = await this.page.locator("[data-user-msg]").count();
    const actualAssistant = await this.page.evaluate(() => {
      const scroll = document.querySelector("[data-scroll]");
      if (!scroll) return 0;
      const wrappers = scroll.querySelectorAll(".animate-in");
      let count = 0;
      for (const w of wrappers) {
        if (!w.querySelector("[data-user-msg]")) count++;
      }
      const children = Array.from(scroll.children);
      for (const c of children) {
        if (c.classList.contains("animate-in")) continue;
        if (c.children.length === 0) continue;
        if (c.querySelector(".animate-in")) continue;
        if (c.querySelector("[data-user-msg]")) continue;
        if (c.textContent?.includes("Thinking")) continue;
        if (c.classList.contains("sticky")) continue;
        if (c.tagName !== "DIV") continue;
        count++;
      }
      return count;
    });
    if (actualUser !== this.expectedUser) {
      throw new Error(`MessageMonitor exact check: User messages: expected ${this.expectedUser}, got ${actualUser}`);
    }
    if (actualAssistant !== this.expectedAssistant) {
      throw new Error(`MessageMonitor exact check: Assistant messages: expected ${this.expectedAssistant}, got ${actualAssistant}`);
    }
    if (this.expectedTextContent) {
      const text = await this.page.evaluate(() => {
        const scroll = document.querySelector("[data-scroll]");
        return scroll ? (scroll.textContent || "").trim() : "";
      });
      if (!text.includes(this.expectedTextContent)) {
        throw new Error(`MessageMonitor content check: Assistant text missing "${this.expectedTextContent}"`);
      }
    }
  }

  get ok(): boolean {
    return this.failures.length === 0;
  }
}
