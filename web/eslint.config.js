// ESLint 9 flat config for the AcuDx web app.
// typescript-eslint (syntax-only recommended, no type-aware rules so `npm run
// lint` stays fast), react-hooks, and react-refresh (Vite HMR boundaries).
import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "playwright-report/**",
      "test-results/**",
      "e2e/__screenshots__/**",
      "public/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // eslint-plugin-react-hooks 7 ships the React Compiler's lint rules as
      // errors. The classic rules (rules-of-hooks, exhaustive-deps) stay at
      // their recommended severity. The five compiler-derived rules below are
      // reported as warnings for now: the 22 existing hits (see the tester
      // handoff) are design-level (refs read during render, setState in
      // effects for derived state) and need a reviewed refactor, not a lint
      // suppression. Promote each back to "error" as its backlog item lands.
      "react-hooks/refs": "warn",
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
      "react-hooks/globals": "warn",
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      // The codebase relies on `_`-prefixed intentionally-unused bindings.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" },
      ],
    },
  },
  {
    // Node scripts (capture and probe tools under e2e/) run outside the browser.
    files: ["e2e/**/*.{mjs,js}"],
    // Callbacks passed to page.evaluate run in the page, so browser globals are valid too.
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  {
    // Playwright specs and config run under Node and use `{}` destructuring in skip predicates.
    files: ["e2e/**/*.ts", "playwright.config.ts", "vite.config.ts", "vitest.config.ts"],
    rules: {
      "no-empty-pattern": "off",
      "react-refresh/only-export-components": "off",
    },
  },
);
