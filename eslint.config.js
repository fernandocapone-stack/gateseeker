// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  // ui/ is a separate Vite + React package with its own tsconfig; it is type-checked by its build.
  { ignores: ["dist/**", "coverage/**", "node_modules/**", "fixtures/**", "ui/**", "ui-kit/**", "web/**", ".e2e-tmp/**", "playwright-report/**", "test-results/**"] },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/consistent-type-definitions": ["error", "interface"],
      "@typescript-eslint/no-unnecessary-condition": "off",
      "@typescript-eslint/restrict-template-expressions": [
        "error",
        { allowNumber: true, allowBoolean: true },
      ],
    },
  },
  {
    files: ["tests/**/*.ts"],
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/dot-notation": "off",
    },
  },
  {
    files: ["eslint.config.js", "vitest.config.ts", "e2e/start.mjs", "e2e/start-web.mjs"],
    extends: [tseslint.configs.disableTypeChecked],
  },
);
