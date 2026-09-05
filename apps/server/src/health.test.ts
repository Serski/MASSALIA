import net from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";

// ---------------------------------------------------------------------------
// /health — the DB probe runs against the *_test database; the failure paths
// point a probe at a port nothing listens on (bound then released) so the
// connection is refused immediately rather than timing out.
// ---------------------------------------------------------------------------

const dbUrl = process.env.DATABASE_URL ?? "";
const suite = describe.runIf(dbUrl.includes("_test"));

// A TCP port that was free a moment ago and has no listener: connect() is refused.
async function closedPort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as net.AddressInfo;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

suite("/health (integration)", () => {
  let health: typeof import("./health.js");
  let closed: number;

  beforeAll(async () => {
    health = await import("./health.js");
    closed = await closedPort();
  });

  const appWith = async (options: import("./health.js").HealthOptions) => {
    const app = Fastify();
    health.registerHealthRoute(app, options);
    await app.ready();
    return app;
  };

  it("200 { ok, db: ok, redis: off } when Postgres answers and Redis is not configured", async () => {
    const app = await appWith({ databaseUrl: dbUrl, redisUrl: null });
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, db: "ok", redis: "off" });
    await app.close();
  });

  it("503 naming db when Postgres is unreachable (closed port)", async () => {
    const app = await appWith({ databaseUrl: `postgres://postgres@127.0.0.1:${closed}/nothing`, redisUrl: null, timeoutMs: 2_000 });
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(503);
    const body = res.json();
    expect(body).toMatchObject({ ok: false, db: "failed", redis: "off" });
    expect(body.error).toMatch(/^db: /);
    await app.close();
  });

  it("503 naming redis when Redis is unreachable (closed port) while Postgres is fine", async () => {
    const app = await appWith({ databaseUrl: dbUrl, redisUrl: `redis://127.0.0.1:${closed}`, timeoutMs: 2_000 });
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(503);
    const body = res.json();
    expect(body).toMatchObject({ ok: false, db: "ok", redis: "failed" });
    expect(body.error).toMatch(/^redis: /);
    await app.close();
  });

  it("checkHealth reports both parts when both fail", async () => {
    const started = Date.now();
    const report = await health.checkHealth({ databaseUrl: `postgres://postgres@127.0.0.1:${closed}/nothing`, redisUrl: `redis://127.0.0.1:${closed}`, timeoutMs: 2_000 });
    expect(report).toMatchObject({ ok: false, db: "failed", redis: "failed" });
    expect(report.error).toMatch(/^db: [^\n]*; redis: [^\n]+$/); // one line, both parts named
    // Refused connections fail fast; the 2s cap is an upper bound, not the norm.
    expect(Date.now() - started).toBeLessThan(2_500);
  });

  afterAll(() => {
    /* pools for the closed-port URL are cached but never connected; nothing to end */
  });
});
