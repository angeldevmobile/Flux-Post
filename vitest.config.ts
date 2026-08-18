import { defineConfig } from "vitest/config";
import path from "path";

// Separate from vite.config.ts, which is an async config wired for Tauri dev.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    setupFiles: ["src/test/setup.ts"],
  },
});
