import { defineConfig } from "vitest/config";

// The server's integration suites (oligarchy, elections) run against ONE real
// Postgres and truncate it between tests. Run test files serially so two suites
// never stomp the same database concurrently.
export default defineConfig({
  test: {
    fileParallelism: false,
    // These suites each do real bcrypt hashing (cost 12) plus several DB
    // round-trips per test; on a loaded machine a single case can exceed the 5s
    // default. Raise the ceiling so real work never trips a spurious timeout.
    testTimeout: 30_000,
  },
});
