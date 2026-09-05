import { defineConfig } from "vitest/config";

// The db package's integration suites (pops, military pools) run against ONE real
// Postgres and truncate shared tables between tests. Run test files serially so two
// suites never stomp the same database concurrently (mirrors apps/server).
export default defineConfig({
  test: {
    fileParallelism: false,
    testTimeout: 30_000,
  },
});
