import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: "./test/setup.ts",
    // A moderate global window; the heavy sequential publish-flow tests carry
    // their own localized timeouts instead of inflating this globally.
    testTimeout: 10000,
    hookTimeout: 10000
  }
});
