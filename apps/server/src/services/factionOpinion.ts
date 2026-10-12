import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { and, eq } from "drizzle-orm";
import { createDb, factionRelations, loadLeagueWar } from "@massalia/db";
import { applyOpinion, factionOfPolity, opinionBand, parseFactionsContent, raidAngers, raidGrudgeLine, type FactionsContent } from "@massalia/shared";
import { getBattleContent } from "./barracks.js";

// ---------------------------------------------------------------------------
// A raid's grudge (raids prompt 2): a raid that lands on a nation's land rolls
// once on the battle's seed and, with raid.opinion.chance, lowers that nation's
// opinion of Massalia by raid.opinion.loss points, clamped at the bar's floor.
// The bar is per world (faction_relations), so every player's raids move it for
// everyone. Unclaimed land and polities no faction holds never roll. No
// effect_log row of its own: the change rides on the raid's report, which is
// already stored (on its march, or on the muster).
// A nation the League is at war with (government prompt 4) is past souring: its
// bar is pinned for the war, so the raid rolls nothing against it, and the raid
// takes the war's plunder multiplier instead.
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

// Null when the land has no faction, when the roll misses, when the nation is
// at war (its bar stays pinned), or when the bar is already at its floor. Otherwise the faction's row (seeded from content when
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
      .select({ id: factionRelations.id, opinion: factionRelations.opinion, atWar: factionRelations.atWar })
      .from(factionRelations)
      .where(and(eq(factionRelations.worldId, worldId), eq(factionRelations.factionId, faction.id)))
      .limit(1)
      .for("update")
  )[0];
  if (!row || row.atWar) return null;
  const from = row.opinion;
  const to = applyOpinion(from, -raid.opinion.loss);
  if (to === from) return null;
  await exec.update(factionRelations).set({ opinion: to, stance: opinionBand(to).id }).where(eq(factionRelations.id, row.id));
  return { factionId: faction.id, name: faction.name, from, to, line: raidGrudgeLine(faction) };
}

// What a won raid on this land takes, times the usual plunder: the war's
// plunderMultiplier when the land's nation is at war with the League (its row,
// else its content start), 1 for anyone else and for land no nation holds.
export async function raidWarMultiplier(exec: DbTx, worldId: string, polityId: string | null): Promise<number> {
  const faction = factionOfPolity(await getFactions(), polityId);
  if (!faction) return 1;
  const row = (
    await exec
      .select({ atWar: factionRelations.atWar })
      .from(factionRelations)
      .where(and(eq(factionRelations.worldId, worldId), eq(factionRelations.factionId, faction.id)))
      .limit(1)
  )[0];
  return (row?.atWar ?? faction.start.atWar) ? (await loadLeagueWar()).plunderMultiplier : 1;
}
