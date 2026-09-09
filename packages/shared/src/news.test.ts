import { describe, expect, it } from "vitest";
import { parseNewsContent, sortNews, type NewsEntry } from "./news.js";

function entry(over: Partial<NewsEntry> & { id: string }): NewsEntry {
  return { date: "2026-09-09", tag: "notice", title: "t", body: ["b"], ...over };
}

describe("news content", () => {
  it("accepts a well-formed entry", () => {
    expect(parseNewsContent([entry({ id: "a" })])).toEqual([entry({ id: "a" })]);
  });

  it("rejects a duplicate id", () => {
    expect(() => parseNewsContent([entry({ id: "a" }), entry({ id: "a", date: "2026-09-08" })])).toThrow(/duplicate news id/);
  });

  it("rejects a date that is not a real calendar day", () => {
    expect(() => parseNewsContent([entry({ id: "a", date: "2026-02-30" })])).toThrow(/real calendar date/);
    expect(() => parseNewsContent([entry({ id: "b", date: "2026-9-9" })])).toThrow(/YYYY-MM-DD/);
  });

  it("rejects an unknown tag, an empty title and an empty body", () => {
    expect(() => parseNewsContent([entry({ id: "a", tag: "gossip" as NewsEntry["tag"] })])).toThrow();
    expect(() => parseNewsContent([entry({ id: "a", title: "" })])).toThrow();
    expect(() => parseNewsContent([entry({ id: "a", body: [] })])).toThrow();
    expect(() => parseNewsContent([entry({ id: "a", body: [""] })])).toThrow();
  });

  it("sorts newest first, then by id", () => {
    const sorted = parseNewsContent([
      entry({ id: "old", date: "2026-01-01" }),
      entry({ id: "z-new", date: "2026-09-09" }),
      entry({ id: "mid", date: "2026-05-05" }),
      entry({ id: "a-new", date: "2026-09-09" }),
    ]);
    expect(sorted.map((e) => e.id)).toEqual(["a-new", "z-new", "mid", "old"]);
    // sortNews is the same order applied on its own (the client re-sorts defensively).
    expect(sortNews([entry({ id: "b", date: "2026-01-01" }), entry({ id: "a", date: "2026-02-02" })]).map((e) => e.id)).toEqual(["a", "b"]);
  });
});
