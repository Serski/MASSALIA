import { defineConfig } from "vitest/config";

// The server's integration suites (oligarchy, elections) run against ONE real
// Postgres and truncate it between tests. Run test files serially so two suites
// never stomp the same database concurrently.
export default defineConfig({
  test: {
    fileParallelism: false,
  },
});
