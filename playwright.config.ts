import { defineConfig } from "@playwright/test";

/**
 * End-to-end tests for the triage interface. `e2e/start.mjs` creates a
 * throwaway git repository under .e2e-tmp/ with two proposed records and then
 * starts the local triage server against it with a fixed token.
 */
export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:4311",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node e2e/start.mjs",
    url: "http://127.0.0.1:4311/",
    reuseExistingServer: false,
    timeout: 30_000,
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
