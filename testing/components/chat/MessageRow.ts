import type { Locator, Page } from "@playwright/test";

export class MessageRow {
  constructor(
    private page: Page,
    private locator: Locator,
  ) {}

  get element(): Locator {
    return this.locator;
  }

  get userMessages(): Locator {
    return this.page.locator("[data-user-msg]");
  }

  get assistantMessages(): Locator {
    return this.page.locator("[data-assistant-msg]");
  }

  get thinkingIndicator(): Locator {
    return this.page.getByText("Thinking");
  }

  get textContent(): Locator {
    return this.locator.locator("p").first();
  }

  async userMessageCount(): Promise<number> {
    return this.userMessages.count();
  }

  async assistantMessageCount(): Promise<number> {
    return this.assistantMessages.count();
  }
}
