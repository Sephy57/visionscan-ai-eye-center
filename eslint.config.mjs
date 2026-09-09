import tsParser from "@typescript-eslint/parser";
import nextPlugin from "@next/eslint-plugin-next";
import reactHooks from "eslint-plugin-react-hooks";

/**
 * Minimal syntax/type-aware parser gate for this Next.js application.
 * Next 16 removed `next lint`; keeping the gate explicit avoids silently
 * accepting a command that only lints a directory named "lint".  TypeScript
 * typechecking remains a separate required gate (`npx tsc --noEmit`).
 */
export default [
  {
    ignores: ["node_modules/**", ".next/**", "data/**", "scratch/**", "tmp/**", "test-results/**"],
  },
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      "@next/next": nextPlugin,
      "react-hooks": reactHooks,
    },
    rules: {},
  },
];
