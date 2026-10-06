import { configDefaults, defineConfig } from "vitest/config";

// Vitest 4 excludes only node_modules and .git by default; tsc compiles the test
// files into dist, so exclude that or every suite runs twice.
export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, "**/dist/**"],
  },
});
