import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  timeout: 300000,
  workers: 1,
  use: {
    browserName: "chromium",
    headless: true,
    slowMo: 500,
    baseURL: "http://localhost:5173",
  },
});
