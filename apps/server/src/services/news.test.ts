import { describe, expect, it } from "vitest";
import { getNews, loadNewsContent } from "./news.js";

// Pure: reads content/news/news.json from disk, never the database, so it runs
// without a DATABASE_URL. The parser's own cases live in @massalia/shared.
describe("news content loader", () => {
  it("the shipped file parses and getNews serves it after load", async () => {
    const loaded = await loadNewsContent();
    expect(loaded.length).toBeGreaterThan(0);
    for (const item of loaded) {
      expect(item.id).not.toBe("");
      expect(item.title).not.toBe("");
      expect(item.body.length).toBeGreaterThan(0);
    }
    expect(getNews()).toEqual(loaded);
  });
});
