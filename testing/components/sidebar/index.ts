import type { Page, Locator } from "@playwright/test";

export class SidePanel {
  constructor(private page: Page) {}

  get container(): Locator {
    return this.page.locator("[data-testid='session-item']").first();
  }

  get sessionItems(): Locator {
    return this.page.locator("[data-testid='session-item']");
  }

  sessionItem(name: string): Locator {
    return this.page.locator("[data-testid='session-item']").filter({ has: this.page.locator(`p:text-is("${name}")`) }).first();
  }

  async reveal() {
    await this.page.mouse.move(2, 200);
    await this.page.waitForTimeout(600);
  }

  async selectSession(index: number) {
    await this.sessionItems.nth(index).click();
    await this.page.waitForTimeout(500);
  }

  async sessionTitle(index: number): Promise<string | null> {
    return this.sessionItems.nth(index).locator("p").first().textContent();
  }

  async isActive(index: number): Promise<boolean> {
    const cls = await this.sessionItems.nth(index).locator("p").first().getAttribute("class");
    return cls?.includes("text-zinc-300") ?? false;
  }

  async renameViaContextMenu(index: number, newTitle: string) {
    await this.reveal();
    const item = this.sessionItems.nth(index);
    await item.click({ button: "right" });
    await this.page.locator("[data-testid='session-menu-rename']").click();
    const input = this.page.locator("[data-testid='session-rename-input']");
    await input.fill(newTitle);
    await input.press("Enter");
    await this.page.waitForTimeout(500);
  }

  async archiveViaContextMenu(index: number) {
    await this.reveal();
    const item = this.sessionItems.nth(index);
    await item.click({ button: "right" });
    await this.page.locator("[data-testid='session-menu-archive']").click();
    await this.page.waitForTimeout(500);
  }
}
