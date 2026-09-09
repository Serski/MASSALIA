import { z } from "zod";

// ---------------------------------------------------------------------------
// News feed schema (the Lobby's news). Content lives in content/news/news.json;
// the server validates it at boot and serves it statically under /content/.
// A content file, not a table: edited in the repo, never through an admin form.
// ---------------------------------------------------------------------------

export const NEWS_TAGS = ["world", "update", "notice"] as const;
export type NewsTag = (typeof NEWS_TAGS)[number];

// YYYY-MM-DD that also names a real day (rejects 2026-02-30, 2026-13-01, …).
function isCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export const newsEntrySchema = z.object({
  id: z.string().min(1),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD")
    .refine(isCalendarDate, "date must be a real calendar date"),
  tag: z.enum(NEWS_TAGS),
  title: z.string().min(1),
  body: z.array(z.string().min(1)).min(1),
});

export const newsSchema = z.array(newsEntrySchema).superRefine((entries, ctx) => {
  const seen = new Set<string>();
  entries.forEach((entry, index) => {
    if (seen.has(entry.id)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [index, "id"], message: `duplicate news id "${entry.id}"` });
    }
    seen.add(entry.id);
  });
});

export type NewsEntry = z.infer<typeof newsEntrySchema>;

// Newest first, ties broken by id so the order is deterministic.
export function sortNews(entries: NewsEntry[]): NewsEntry[] {
  return [...entries].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

// Validate + order.
export function parseNewsContent(raw: unknown): NewsEntry[] {
  return sortNews(newsSchema.parse(raw));
}
