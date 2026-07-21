import type { Page, Locator } from "@playwright/test";
import { MessageRow } from "./MessageRow";

export class ChatPage {
  constructor(private page: Page) {}

  get input(): Locator {
    return this.page.locator("[data-testid='message-input']");
  }

  get sendButton(): Locator {
    return this.page.locator("[data-testid='send']");
  }

  get stopButton(): Locator {
    return this.page.locator("[data-testid='stop']");
  }

  get userMessages(): Locator {
    return this.page.locator("[data-user-msg]");
  }

  get messagePanelToggle(): Locator {
    return this.page.locator("[data-testid='message-panel-toggle']");
  }

  get messagePanel(): Locator {
    return this.page.locator("[data-testid='message-panel']");
  }

  get messages(): MessageRow {
    return new MessageRow(this.page, this.page.locator("[data-user-msg]").first());
  }

  get lastMessage(): MessageRow {
    return new MessageRow(this.page, this.page.locator("[data-user-msg]").last());
  }

  async sendMessage(text: string) {
    await this.input.fill(text);
    await this.sendButton.click();
  }

  async openMessagePanel() {
    await this.messagePanelToggle.click();
    await this.page.waitForTimeout(300);
  }

  async closeMessagePanel() {
    if (await this.messagePanelToggle.isVisible()) {
      await this.messagePanelToggle.click();
      await this.page.waitForTimeout(200);
    }
  }

  async isMessagePanelOpen(): Promise<boolean> {
    return this.messagePanel.isVisible().catch(() => false);
  }

  async isMessagePanelPinned(): Promise<boolean> {
    const pin = this.page.locator("[data-testid='message-panel-pin']");
    if (!(await pin.isVisible().catch(() => false))) return false;
    const title = (await pin.getAttribute("title")) ?? "";
    return title === "Unpin";
  }

  async isMessagePanelFullWidth(): Promise<boolean> {
    const cls = (await this.messagePanel.getAttribute("class")) ?? "";
    return cls.includes("w-full");
  }

  async waitForResponse(timeout = 15000) {
    // Wait for a done event by watching for a non-streaming assistant message
    await this.page.waitForTimeout(timeout);
  }
}
