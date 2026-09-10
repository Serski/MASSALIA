import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Region display names for Chronicle lines and reports: the public names file
// the map shows (apps/web/public/map2/names2.json), read once. Absent or
// unreadable, the id is used.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../../..");
const namesFile = path.join(repoRoot, "apps/web/public/map2/names2.json");
let names: Record<string, string> | null = null;

export async function regionDisplayName(regionId: string): Promise<string> {
  if (!names) {
    try {
      names = (JSON.parse(await fs.readFile(namesFile, "utf8")) as { names?: Record<string, string> }).names ?? {};
    } catch {
      names = {};
    }
  }
  return names[regionId] ?? regionId;
}
