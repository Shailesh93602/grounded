import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Offline by default — no DB, no API key needed.
    testTimeout: 15_000,
  },
});
