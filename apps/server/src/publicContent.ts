import path from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";

// The content files the API serves at /content/. The web client reads exactly
// two of them: `api.ageConfig` fetches /content/age/age-config.json and
// `api.news` fetches /content/news/news.json (apps/web/src/api.ts). Everything
// else under content/ — the town and region military numbers, the battle and
// unit tables, every event and story file with its branches and rewards — is
// server-side truth and answers 404. A file the client needs later is added to
// this list and nowhere else; the mount is never widened past it.
export const PUBLIC_CONTENT_FILES = ["/age/age-config.json", "/news/news.json"] as const;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultRoot = path.resolve(__dirname, "../../..", "content");

// Mount content/ at /content/, serving only PUBLIC_CONTENT_FILES. @fastify/static
// hands `allowedPath` the request path after the prefix: leading slash, posix-
// normalized, still URI-encoded. An exact match against the list means an
// encoded or dotted spelling of an allowed file (…/map%2F…, /news/../news/…)
// falls outside it and answers 404 too; the client never sends one.
export async function registerPublicContent(app: FastifyInstance, root: string = defaultRoot): Promise<void> {
  const allowed: ReadonlySet<string> = new Set<string>(PUBLIC_CONTENT_FILES);
  await app.register(fastifyStatic, {
    root,
    prefix: "/content/",
    allowedPath: (pathName) => allowed.has(pathName),
  });
}
