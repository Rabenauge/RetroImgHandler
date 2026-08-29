import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/browser",
  use: { baseURL: "http://127.0.0.1:4175" },
  webServer: { command: "npm run dev", url: "http://127.0.0.1:4175", reuseExistingServer: true }
});
