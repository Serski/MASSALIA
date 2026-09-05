import crypto from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";

// ---------------------------------------------------------------------------
// /api/map/stream connection cap — integration test against a REAL Postgres,
// guarded to a *_test database. SSE streams stay open, which app.inject() cannot
// model, so the app listens on an ephemeral port and real fetch() streams are held
// open with AbortControllers.
// ---------------------------------------------------------------------------

const dbUrl = process.env.DATABASE_URL ?? "";
const suite = describe.runIf(dbUrl.includes("_test"));

async function loadModules() {
  const dbPkg = await import("@massalia/db");
  const map = await import("./map.js");
  const { errorHandler } = await import("../errorHandler.js");
  return { dbPkg, map, errorHandler };
}
type Mods = Awaited<ReturnType<typeof loadModules>>;

suite("map stream connection cap (integration)", () => {
  let m: Mods;
  let db: ReturnType<Mods["dbPkg"]["createDb"]>;
  let app: FastifyInstance;
  let baseUrl: string;

  beforeAll(async () => {
    m = await loadModules();
    db = m.dbPkg.createDb();
    // forceCloseConnections: streams left open by a failing assertion must not hang afterAll.
    app = Fastify({ forceCloseConnections: true });
    app.setErrorHandler(m.errorHandler);
    await app.register(cookie, { secret: "test-session-secret-at-least-32-chars-long" });
    await app.register(m.map.mapRoutes, { prefix: "/api/map" });
    await app.listen({ port: 0, host: "127.0.0.1" });
    const address = app.server.address();
    if (!address || typeof address === "string") throw new Error("no address");
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE sessions, player_characters, players, dynasties, worlds, users CASCADE`);
  });

  const sessionFor = async () => {
    const user = (await db.insert(m.dbPkg.users).values({ email: `u-${crypto.randomUUID()}@t`, passwordHash: "x" }).returning())[0]!;
    const raw = crypto.randomBytes(32).toString("base64url");
    await db.insert(m.dbPkg.sessions).values({ userId: user.id, tokenHash: crypto.createHash("sha256").update(raw).digest("hex"), expiresAt: new Date(Date.now() + 86_400_000) });
    return { userId: user.id, cookie: `massalia_session=${app.signCookie(raw)}` };
  };

  // Open a stream and resolve once the response headers are in (the body stays open).
  const openStream = async (cookieHeader: string) => {
    const controller = new AbortController();
    const response = await fetch(`${baseUrl}/api/map/stream`, { headers: { cookie: cookieHeader }, signal: controller.signal });
    return { response, close: () => controller.abort() };
  };

  const waitFor = async (predicate: () => boolean, ms = 3_000) => {
    const deadline = Date.now() + ms;
    while (!predicate()) {
      if (Date.now() > deadline) throw new Error("timed out waiting for stream bookkeeping");
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  };

  it("a user may hold 3 streams; the 4th is refused with 429 and a closed slot frees up", async () => {
    const alice = await sessionFor();
    const streams = [];
    for (let i = 0; i < m.map.MAX_STREAMS_PER_USER; i++) {
      const stream = await openStream(alice.cookie);
      expect(stream.response.status).toBe(200);
      expect(stream.response.headers.get("content-type")).toBe("text/event-stream");
      streams.push(stream);
    }
    expect(m.map.openStreamCount(alice.userId)).toBe(m.map.MAX_STREAMS_PER_USER);

    // The first frame is the full-state snapshot.
    const reader = streams[0]!.response.body!.getReader();
    const first = new TextDecoder().decode((await reader.read()).value);
    expect(first).toMatch(/^event: state\n/);

    const fourth = await openStream(alice.cookie);
    expect(fourth.response.status).toBe(429);
    expect(await fourth.response.json()).toEqual({ error: "You already have 3 map streams open. Close one and try again." });
    expect(m.map.openStreamCount(alice.userId)).toBe(m.map.MAX_STREAMS_PER_USER);

    // Another user is unaffected by Alice's cap.
    const bob = await sessionFor();
    const his = await openStream(bob.cookie);
    expect(his.response.status).toBe(200);

    // Closing one of Alice's streams decrements the count and admits a new one.
    streams[1]!.close();
    await waitFor(() => m.map.openStreamCount(alice.userId) === m.map.MAX_STREAMS_PER_USER - 1);
    const again = await openStream(alice.cookie);
    expect(again.response.status).toBe(200);

    for (const stream of [...streams, his, again]) stream.close();
    await waitFor(() => m.map.openStreamCount(alice.userId) === 0 && m.map.openStreamCount(bob.userId) === 0);
  });

  it("an anonymous caller gets 401 and no slot is consumed", async () => {
    const response = await fetch(`${baseUrl}/api/map/stream`);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Authentication required" });
  });
});
