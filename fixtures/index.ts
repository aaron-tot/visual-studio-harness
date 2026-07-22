import { test as base, type Page } from "@playwright/test";
import { Header } from "../components/header";
import { SidePanel } from "../components/sidebar";
import { ChatPage } from "../components/chat";
import { SettingsModal } from "../components/settings";

type Components = {
  header: Header;
  sidebar: SidePanel;
  chat: ChatPage;
  settings: SettingsModal;
};

export const test = base.extend<Components>({
  header: async ({ page }, use) => use(new Header(page)),
  sidebar: async ({ page }, use) => use(new SidePanel(page)),
  chat: async ({ page }, use) => use(new ChatPage(page)),
  settings: async ({ page }, use) => use(new SettingsModal(page)),
});

export { expect } from "@playwright/test";

export function wait(page: Page, ms?: number) {
  const timeout = ms ?? (process.env.WAIT ? Number(process.env.WAIT) : 2000);
  if (timeout <= 0) return Promise.resolve();
  return page.waitForTimeout(timeout);
}
