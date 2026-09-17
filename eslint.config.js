import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: ["dist", "node_modules", "coverage"],
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      // `const { key: _omit, ...rest } = obj` is the idiom for dropping a key; the
      // discarded sibling is not an unused variable.
      "@typescript-eslint/no-unused-vars": ["error", { ignoreRestSiblings: true }]
    }
  },
  {
    // A hook after an early return blacked out the map for every player on
    // 10 Sept 2026 (React #310). This fails it at lint, on every component.
    files: ["apps/web/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: { "react-hooks/rules-of-hooks": "error" }
  }
);
