import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
    testTimeout: 60000,
    // Keep hook timeouts honest; isolated SQLite teardown should complete well
    // below this budget and must not hide a persistence regression.
    hookTimeout: 30000,
    // A single worker keeps native image/OCR fixtures predictable. Each run is
    // independently rooted by tests/setup.ts, so this is no longer a workaround
    // for a shared whole-file JSON database.
    fileParallelism: false,
    // NOTE: native modules in the S2 extraction suite are lazy-loaded
    // (no top-level @napi-rs/canvas import).
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
