import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";

type CheckFn = () => Promise<void> | void;

export class CheckLoop {
  private checks = new Map<string, CheckFn>();
  private active = new Set<string>();
  private interval: ReturnType<typeof setInterval> | null = null;
  private page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  register(name: string, fn: CheckFn, startActive = false) {
    this.checks.set(name, fn);
    if (startActive) this.active.add(name);
  }

  start(name: string) {
    if (!this.checks.has(name)) throw new Error("Unknown check: " + name);
    this.active.add(name);
  }

  stop(name: string) { this.active.delete(name); }
  startAll() { for (const name of this.checks.keys()) this.active.add(name); }
  stopAll() { this.active.clear(); }

  begin(intervalMs = 20) {
    if (this.interval) return;
    this.interval = setInterval(async () => {
      for (const name of this.active) {
        const fn = this.checks.get(name);
        if (!fn) continue;
        try {
          await fn();
        } catch (err) {
          this.end();
          throw err;
        }
      }
    }, intervalMs);
  }

  end() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }
}
