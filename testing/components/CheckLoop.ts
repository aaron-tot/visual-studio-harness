import type { Page } from "@playwright/test";

type CheckFn = () => Promise<void> | void;

export class CheckLoop {
  private checks = new Map<string, CheckFn>();
  private active = new Set<string>();
  private interval: ReturnType<typeof setInterval> | null = null;
  private page: Page;
  private lastError: Error | null = null;
  private running = false;

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

  begin(intervalMs = 50) {
    if (this.interval) return;
    this.interval = setInterval(() => {
      if (this.running || this.lastError) return;
      this.running = true;
      void (async () => {
        try {
          for (const name of [...this.active]) {
            if (this.lastError) break;
            const fn = this.checks.get(name);
            if (!fn) continue;
            await fn();
          }
        } catch (err) {
          this.lastError = err instanceof Error ? err : new Error(String(err));
          this.end();
        } finally {
          this.running = false;
        }
      })();
    }, intervalMs);
  }

  /** Throw if any background check already failed. Call from the main test loop. */
  assertOk() {
    if (this.lastError) throw this.lastError;
  }

  end() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }
}
