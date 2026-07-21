import type { Page, Locator } from "@playwright/test";

export class SettingsModal {
  constructor(private page: Page) {}

  get backdrop(): Locator {
    return this.page.locator(".fixed.inset-0.bg-black\\/50");
  }

  get closeButton(): Locator {
    return this.page.locator("svg.lucide-x").first();
  }

  get tabs(): Locator {
    return this.page.locator("button").filter({ hasText: /General|Providers|Agents|MD Files|Tools|System/ });
  }

  tab(name: string): Locator {
    return this.page.locator("button").filter({ hasText: name }).first();
  }

  async isOpen(): Promise<boolean> {
    return this.backdrop.isVisible();
  }

  async close() {
    await this.closeButton.click();
    await this.page.waitForTimeout(300);
  }

  async switchTab(name: string) {
    await this.tab(name).click();
    await this.page.waitForTimeout(200);
  }

  async setTestModelSpeed(modelLabel: string, tps: number) {
    const card = this.page.locator("label").filter({ hasText: modelLabel }).first().locator("..");
    await card.locator('input[type="number"]').fill(String(tps));
    await this.page.waitForTimeout(200);
  }

  get fullwidthCheckbox(): Locator {
    return this.page
      .locator("label")
      .filter({ hasText: "Fullwidth" })
      .locator('input[type="checkbox"]')
      .first();
  }

  async setFullwidth(on: boolean) {
    const cb = this.fullwidthCheckbox;
    const checked = await cb.isChecked().catch(() => false);
    if (checked !== on) {
      await cb.click();
      await this.page.waitForTimeout(200);
    }
  }

  get pinnedDefaultCheckbox(): Locator {
    return this.page
      .locator("label")
      .filter({ hasText: "Pinned by default" })
      .locator('input[type="checkbox"]')
      .first();
  }

  async setPinnedDefault(on: boolean) {
    const cb = this.pinnedDefaultCheckbox;
    const checked = await cb.isChecked().catch(() => false);
    if (checked !== on) {
      await cb.click();
      await this.page.waitForTimeout(200);
    }
  }
}
