import { configDefaults, defineConfig } from "vitest/config";

// The db package's integration suites (pops, military pools) run against ONE real
// Postgres and truncate shared tables between tests. Run test files serially so two
// suites never stomp the same database concurrently (mirrors apps/server).
export default defineConfig({
  test: {
    // Vitest 4 excludes only node_modules and .git by default; tsc compiles the
    // test files into dist, so exclude that or every suite runs twice.
    exclude: [...configDefaults.exclude, "**/dist/**"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
