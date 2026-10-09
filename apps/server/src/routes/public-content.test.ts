import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { PUBLIC_CONTENT_FILES, registerPublicContent } from "../publicContent.js";

// ---------------------------------------------------------------------------
// The /content/ mount (publicContent.ts) serves exactly the two files the web
// client reads and answers 404 for every other file under content/. The town
// and region military numbers, the battle and unit tables and every event and
// story file are server-side truth: before this mount was closed, anyone could
// read them from the API. No database: a bare Fastify app over the REAL content
// directory, so a new content file is covered the day it lands.
// ---------------------------------------------------------------------------

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const contentRoot = path.resolve(__dirname, "../../../..", "content");

// Every .json file under content/, as the mount would spell it: "/age/age-config.json".
function walkJson(dir: string, prefix = ""): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = `${prefix}/${entry.name}`;
    if (entry.isDirectory()) out.push(...walkJson(path.join(dir, entry.name), rel));
    else if (entry.isFile() && entry.name.endsWith(".json")) out.push(rel);
  }
  return out.sort();
}

describe("GET /content/ serves only the files the client reads", () => {
  let app: FastifyInstance;
  const allowed = new Set<string>(PUBLIC_CONTENT_FILES);
  const everyJson = walkJson(contentRoot);
  const closed = everyJson.filter((rel) => !allowed.has(rel));

  beforeAll(async () => {
    expect(fs.existsSync(contentRoot)).toBe(true);
    app = Fastify();
    await registerPublicContent(app, contentRoot);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("walked the real content directory", () => {
    // Sanity: the walk found the two open files and a meaningful number of closed ones.
    for (const rel of PUBLIC_CONTENT_FILES) expect(everyJson).toContain(rel);
    expect(closed.length).toBeGreaterThan(20);
  });

  it.each([...PUBLIC_CONTENT_FILES])("%s answers 200 with the file on disk", async (rel) => {
    const res = await app.inject({ method: "GET", url: `/content${rel}` });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toMatch(/^application\/json/);
    const onDisk = JSON.parse(fs.readFileSync(path.join(contentRoot, rel), "utf8"));
    expect(JSON.parse(res.body)).toEqual(onDisk);
  });

  it("the town and region military numbers answer 404", async () => {
    // The reason this test exists: garrison, pentekonter and trireme counts per
    // town and region are secret (AGENTS.md, Invariants) and were readable here.
    for (const rel of ["/map/town-military.json", "/map/region-military.json"]) {
      expect(fs.existsSync(path.join(contentRoot, rel))).toBe(true);
      const get = await app.inject({ method: "GET", url: `/content${rel}` });
      expect(get.statusCode, `GET ${rel}`).toBe(404);
      const head = await app.inject({ method: "HEAD", url: `/content${rel}` });
      expect(head.statusCode, `HEAD ${rel}`).toBe(404);
    }
  });

  it("every other .json file under content/ answers 404 by GET and by HEAD", async () => {
    const leaks: string[] = [];
    for (const rel of closed) {
      const get = await app.inject({ method: "GET", url: `/content${rel}` });
      if (get.statusCode !== 404) leaks.push(`GET ${rel} -> ${get.statusCode}`);
      const head = await app.inject({ method: "HEAD", url: `/content${rel}` });
      if (head.statusCode !== 404) leaks.push(`HEAD ${rel} -> ${head.statusCode}`);
    }
    expect(leaks).toEqual([]);
  });

  it.each(["/content/news/../map/town-military.json", "/content/map%2Ftown-military.json"])(
    "%s does not answer 200",
    async (url) => {
      const res = await app.inject({ method: "GET", url });
      expect(res.statusCode).not.toBe(200);
    },
  );

  it.each(["/content/", "/content/news/"])("%s answers 404", async (url) => {
    const res = await app.inject({ method: "GET", url });
    expect(res.statusCode).toBe(404);
  });
});
