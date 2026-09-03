import js from "@eslint/js";
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
  }
);
