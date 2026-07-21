import type { Page, Locator } from "@playwright/test";

export class AgentDropdown {
  constructor(private page: Page) {}

  get trigger(): Locator {
    return this.page.locator("button").filter({ hasText: /^Agent/ }).first();
  }

  get modelDropdown(): Locator {
    return this.page.locator("button").filter({ hasText: /Model/ }).first();
  }

  get thinkingDropdown(): Locator {
    return this.page.locator("button").filter({ hasText: /off|low|medium|high/ }).first();
  }

  async selectAgent(name: string) {
    await this.trigger.click();
    await this.page.locator("button").filter({ hasText: name }).first().click();
    await this.page.waitForTimeout(300);
  }

  async selectModel(provider: string, model: string) {
    await this.modelDropdown.click();
    await this.page.locator("text=" + model).first().click();
    await this.page.waitForTimeout(300);
  }
}
