import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseBandsContent, parseUnitsContent, type BandsContent, type UnitsContent } from "@massalia/shared";
import { getBuildingsContent } from "./buildings.js";

// ---------------------------------------------------------------------------
// Barracks — the player's army: trained UNITS raised from the levy and hired
// BANDS on seasonal contracts. Content lives in content/military/units.json and
// bands.json and reaches the client only through /api/barracks; nothing here is
// copied under apps/web/public.
//
// Unrelated to merc.ts (the Hoplite's personal contracts), which is untouched.
// ---------------------------------------------------------------------------

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../../..");
const unitsFile = path.join(repoRoot, "content/military/units.json");
const bandsFile = path.join(repoRoot, "content/military/bands.json");

let units: UnitsContent | null = null;
let bands: BandsContent | null = null;

// Validate both catalogues at boot (fail fast on a malformed file); memoized.
// Gear and upkeep good ids are checked against the buildings.json vendor list,
// so loadBuildingsContent() must have run first.
export async function loadBarracksContent(): Promise<{ units: UnitsContent; bands: BandsContent }> {
  const goods = Object.keys(getBuildingsContent().vendor);
  units = parseUnitsContent(JSON.parse(await fs.readFile(unitsFile, "utf8")), goods);
  bands = parseBandsContent(JSON.parse(await fs.readFile(bandsFile, "utf8")), goods);
  return { units, bands };
}

export function getUnitsContent(): UnitsContent {
  if (!units) throw new Error("Units content not loaded. Call loadBarracksContent() at boot.");
  return units;
}

export function getBandsContent(): BandsContent {
  if (!bands) throw new Error("Bands content not loaded. Call loadBarracksContent() at boot.");
  return bands;
}
