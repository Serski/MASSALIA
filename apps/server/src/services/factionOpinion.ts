import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { and, eq } from "drizzle-orm";
import { createDb, factionRelations } from "@massalia/db";
import { applyOpinion, factionOfPolity, opinionBand, parseFactionsContent, raidAngers, raidGrudgeLine, type FactionsContent } from "@massalia/shared";
import { getBattleContent } from "./barracks.js";

// ---------------------------------------------------------------------------
// A raid's grudge (raids prompt 2): a raid that lands on a nation's land rolls
// once on the battle's seed and, with raid.opinion.chance, lowers that nation's
// opinion of Massalia by raid.opinion.loss points, clamped at the bar's floor.
// The bar is per world (faction_relations), so every player's raids move it for
// everyone. Unclaimed land and polities no faction holds never roll. No
// effect_log row of its own: the change rides on the raid's report, which is
// already stored (the map_action detail, the muster's report).
// ---------------------------------------------------------------------------

type DbTx = Parameters<Parameters<ReturnType<typeof createDb>["transaction"]>[0]>[0];

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const factionsFile = path.resolve(__dirname, "../../../..", "content/diplomacy/factions.json");

// The factions content, read and parsed once, as eventEngine's getFactionDefaults does.
let factions: FactionsContent | null = null;
async function getFactions(): Promise<FactionsContent> {
  if (!factions) factions = parseFactionsContent(JSON.parse(await fs.readFile(factionsFile, "utf8")));
  return factions;
}

export type RaidOpinion = { factionId: string; name: string; from: number; to: number; line: string };

// Null when the land has no faction, when the roll misses, or when the bar is
// already at its floor. Otherwise the faction's row (seeded from content when
// absent, as the event engine seeds it) is locked and lowered, its stance kept
// in step with the opinion band.
export async function raidOpinion(exec: DbTx, worldId: string, polityId: string | null, seed: string): Promise<RaidOpinion | null> {
  const faction = factionOfPolity(await getFactions(), polityId);
  if (!faction) return null;
  const raid = getBattleContent().raid;
  if (!raidAngers(raid, seed)) return null;
  const def = faction.start;
  await exec
    .insert(factionRelations)
    .values({ worldId, factionId: faction.id, stance: opinionBand(def.opinion).id, opinion: def.opinion, atWar: def.atWar, allied: def.allied, vassal: def.vassal })
    .onConflictDoNothing();
  const row = (
    await exec
      .select({ id: factionRelations.id, opinion: factionRelations.opinion })
      .from(factionRelations)
      .where(and(eq(factionRelations.worldId, worldId), eq(factionRelations.factionId, faction.id)))
      .limit(1)
      .for("update")
  )[0];
  if (!row) return null;
  const from = row.opinion;
  const to = applyOpinion(from, -raid.opinion.loss);
  if (to === from) return null;
  await exec.update(factionRelations).set({ opinion: to, stance: opinionBand(to).id }).where(eq(factionRelations.id, row.id));
  return { factionId: faction.id, name: faction.name, from, to, line: raidGrudgeLine(faction) };
}
