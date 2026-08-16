import { defineConfig } from "vitest/config";

/**
 * Vitest configuration. The pure logic and port-driven orchestration under test
 * never touch Foundry globals, so a plain Node environment is sufficient.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    clearMocks: true
  }
});
