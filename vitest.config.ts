import { defineConfig } from "vitest/config";
import path from "path";

// Kept separate from vite.config.ts: that one is an async config wired for Tauri
// dev (fixed port, src-tauri watch rules) and none of it applies to a test run.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
