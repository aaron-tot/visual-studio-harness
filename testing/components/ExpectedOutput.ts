import type { Page } from "@playwright/test";

export class ExpectedOutput {
  private full: string;
  private modelName: string;

  constructor(modelName: string, fullText: string) {
    this.full = fullText;
    this.modelName = modelName;
  }

  get fullText(): string {
    return this.full;
  }

  get model(): string {
    return this.modelName;
  }

  private async getVisibleText(page: Page): Promise<string> {
    const texts = await page.locator("[data-assistant-msg]").allTextContents();
    return texts.join(" ").trim().replace(/\s+/g, " ");
  }

  async assertPrefix(page: Page): Promise<void> {
    const visible = await this.getVisibleText(page);
    if (visible.length === 0) return;
    if (!this.full.startsWith(visible)) {
      throw new Error(
        "[" + this.modelName + "] Visible text does not match expected prefix\n" +
        "Expected: " + this.full.substring(0, Math.min(80, this.full.length)) + "\n" +
        "Got:      " + visible.substring(0, 80)
      );
    }
  }

  async assertComplete(page: Page): Promise<void> {
    const visible = await this.getVisibleText(page);
    if (visible !== this.full) {
      throw new Error(
        "[" + this.modelName + "] Visible text does not match full expected output\n" +
        "Expected length: " + this.full.length + ", got: " + visible.length + "\n" +
        "Expected: " + this.full.substring(0, 100) + "\n" +
        "Got:      " + visible.substring(0, 100)
      );
    }
  }
}
