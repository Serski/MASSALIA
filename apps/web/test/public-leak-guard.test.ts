import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// Leak guard: everything under apps/web/public is world-readable, so no military
// number may ever ship there. Scans every text asset for the secret keys. Lives
// outside src/ on purpose — the web tsconfig type-checks src only, and this test
// needs node:fs.
// ---------------------------------------------------------------------------

const publicDir = resolve(dirname(fileURLToPath(import.meta.url)), "../public");
const SECRET_KEYS = ["garrison", "pentekonters", "triremes", "warband"];
const TEXT_EXT = new Set([".json", ".js", ".mjs", ".css", ".html", ".txt", ".svg", ".xml", ".md", ".csv"]);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

describe("apps/web/public leak guard", () => {
  const textFiles = walk(publicDir).filter((f) => TEXT_EXT.has(extname(f).toLowerCase()));

  it("scans a non-trivial set of public text assets", () => {
    expect(textFiles.length).toBeGreaterThan(0);
    expect(textFiles.some((f) => f.endsWith("map2/townstats.json"))).toBe(true);
  });

  it("no public text asset contains a military key", () => {
    const offenders: string[] = [];
    for (const file of textFiles) {
      const text = readFileSync(file, "utf8");
      for (const key of SECRET_KEYS) {
        if (new RegExp(`"${key}"`).test(text) || new RegExp(`\\b${key}\\b`, "i").test(text)) {
          offenders.push(`${file.slice(publicDir.length + 1)}: ${key}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("townstats.json carries only population and walls per town", () => {
    const file = JSON.parse(readFileSync(join(publicDir, "map2/townstats.json"), "utf8")) as {
      towns: Record<string, Record<string, unknown>>;
    };
    expect(Object.keys(file.towns)).toHaveLength(105);
    for (const [id, town] of Object.entries(file.towns)) {
      expect(Object.keys(town).sort(), id).toEqual(["population", "walls"]);
    }
  });
});
