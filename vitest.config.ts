import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    // Unit tests must never reach the network. The OSV client is exercised
    // through an injected fetch; the live check is an explicit, opt-in script.
    testTimeout: 10_000,
  },
});
