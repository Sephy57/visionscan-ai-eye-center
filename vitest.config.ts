import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    testTimeout: 60000,
    // Cleanup may serialize several full JSON-store rewrites after document
    // and verification suites. Give hooks a realistic budget without
    // changing individual test assertions or production behavior.
    hookTimeout: 30000,
    // Sequential file execution: the JSON document store persists the WHOLE
    // database per write and is documented as single-process (lib/storage/db.ts).
    // Parallel test files each hold their own in-memory copy and race
    // (lost updates / resurrected deletes) - so files must not run in
    // parallel against the shared D: database.
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
