import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseNewsContent, type NewsEntry } from "@massalia/shared";

export type { NewsEntry } from "@massalia/shared";

// The game's news feed (Lobby): a content file, not a table — edited in the repo
// and validated at boot like every other content file (the parser lives in
// @massalia/shared next to the other content parsers). Read-only at runtime;
// the client fetches the file itself from /content/news/news.json.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../../..");
const newsFile = path.join(repoRoot, "content/news/news.json");

let news: NewsEntry[] | null = null;

export async function loadNewsContent(): Promise<NewsEntry[]> {
  news = parseNewsContent(JSON.parse(await fs.readFile(newsFile, "utf8")));
  return news;
}

export function getNews(): NewsEntry[] {
  if (!news) throw new Error("News content not loaded. Call loadNewsContent() at boot.");
  return news;
}
