import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    restoreMocks: true,
    clearMocks: true,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
