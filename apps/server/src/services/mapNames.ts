import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Display names for Chronicle lines and reports: regions from the public names
// file the map shows (apps/web/public/map2/names2.json), towns from the public
// world file (world2.json), each read once. Absent or unreadable, the id is used.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../../..");
const namesFile = path.join(repoRoot, "apps/web/public/map2/names2.json");
const worldFile = path.join(repoRoot, "apps/web/public/map2/world2.json");
let names: Record<string, string> | null = null;
let townNames: Record<string, string> | null = null;

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

export async function townDisplayName(townId: string): Promise<string> {
  if (!townNames) {
    try {
      const towns = (JSON.parse(await fs.readFile(worldFile, "utf8")) as { towns?: { id: string; name: string }[] }).towns ?? [];
      townNames = Object.fromEntries(towns.map((t) => [t.id, t.name]));
    } catch {
      townNames = {};
    }
  }
  return townNames[townId] ?? townId;
}

// The display name of a base or target id: a town when the id is a town, else a region.
export async function placeDisplayName(id: string, isTown: boolean): Promise<string> {
  return isTown ? townDisplayName(id) : regionDisplayName(id);
}
