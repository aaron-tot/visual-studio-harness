import type { Page, Locator } from "@playwright/test";

export class Header {
  constructor(private page: Page) {}

  get settingsButton(): Locator {
    return this.page.locator("[data-testid='settings']");
  }

  get newChatButton(): Locator {
    return this.page.locator("[data-testid='new-chat']");
  }

  get searchInput(): Locator {
    return this.page.getByPlaceholder("Search...");
  }

  get searchIcon(): Locator {
    return this.page.locator("svg.lucide-search").first();
  }

  async clickNewChat() {
    await this.newChatButton.click();
  }

  async clickSettings() {
    await this.settingsButton.click();
  }

  async openSearch() {
    await this.searchIcon.hover();
    await this.page.waitForTimeout(400);
    await this.searchInput.click({ force: true });
  }
}
