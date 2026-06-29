import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { and, eq, sql } from "drizzle-orm";
import {
  applyCityStat,
  applyOpinion,
  applyStatGrowth,
  capStat,
  clampIdeology,
  opinionBand,
  parseCitiesContent,
  parseEventFile,
  parseFactionsContent,
  type EventChoice,
  type EventDefinition,
} from "@massalia/shared";
import { createDb, effectLog, eventHistory, factionRelations, leagueCities, partyFavor, playerCharacters, worlds } from "@massalia/db";
import { broadcastState, resolveOwnerToken, setProvinceOwner } from "./worldState.js";
import { applyChangeTrait, TraitRuleError } from "./traits.js";
import { onIdeologyChanged } from "./politics.js";
import { getAgeConfig } from "./age.js";

const db = createDb();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../../..");
const eventsDir = path.join(repoRoot, "content/events");
const citiesFile = path.join(repoRoot, "content/cities/cities.json");
const factionsFile = path.join(repoRoot, "content/diplomacy/factions.json");

// Content START values for the world-scoped effects' ensure-on-read (mirrors the
// /api/league route's seed-on-read): a city/faction the effect targets may have no
// row yet, so we insert the content default first, then apply the change on top.
// Memoized; an unknown id is absent here and the effect skips it (no throw).
let cityDefaults: Map<string, { population: number; tax: number; stability: number; fortifications: number; garrison: number }> | null = null;
let factionDefaults: Map<string, { opinion: number; atWar: boolean; allied: boolean; vassal: boolean }> | null = null;
async function getCityDefaults() {
  if (!cityDefaults) {
    const content = parseCitiesContent(JSON.parse(await fs.readFile(citiesFile, "utf8")));
    cityDefaults = new Map(content.cities.map((c) => [c.id, c.start]));
  }
  return cityDefaults;
}
async function getFactionDefaults() {
  if (!factionDefaults) {
    const content = parseFactionsContent(JSON.parse(await fs.readFile(factionsFile, "utf8")));
    factionDefaults = new Map(content.factions.map((f) => [f.id, f.start]));
  }
  return factionDefaults;
}

// Load every event file. Files may be a single event or an array of events
// (category packs). Validated against the Zod schema — fail loudly at boot.
export async function listEvents(): Promise<EventDefinition[]> {
  const files = (await fs.readdir(eventsDir)).filter((file) => file.endsWith(".json"));
  const groups = await Promise.all(
    files.map(async (file) => {
      const content = await fs.readFile(path.join(eventsDir, file), "utf8");
      try {
        return parseEventFile(JSON.parse(content));
      } catch (error) {
        throw new Error(`Invalid event content in ${file}: ${(error as Error).message}`);
      }
    }),
  );
  return groups.flat();
}

export async function findChoice(eventId: string, choiceId: string): Promise<{ event: EventDefinition; choice: EventChoice }> {
  const events = await listEvents();
  const event = events.find((candidate) => candidate.id === eventId);
  if (!event) throw new Error(`Unknown event ${eventId}`);
  const choice = event.choices.find((candidate) => candidate.id === choiceId);
  if (!choice) throw new Error(`Unknown choice ${choiceId}`);
  return { event, choice };
}

// Apply a choice's effects for the acting character. Direct row effects + the
// effect log + event_history are committed in one transaction; the rule-enforcing
// trait service and the break-aware composure service run alongside. The ideology
// drift/censure hook and the SSE broadcast fire after the work is done.
// NOTE: composure (the trait/ideology layer + explicit change_composure effects) is
// applied by the events route as a single combined delta, so it is intentionally NOT
// handled here — that keeps the up-front preview equal to what resolving applies.
export async function applyChoiceEffects(actingCharacterId: string, eventId: string, choice: EventChoice) {
  let ideologyTouched = false;
  const traitEffects = choice.effects.filter((e) => e.type === "change_trait");

  // World-scoped effects (Atlas Phase 2b-ii) are explicitly-targeted; resolve their
  // content defaults outside the tx (file IO) only when this choice actually uses one.
  const hasWorldEffect = choice.effects.some(
    (e) => e.type === "change_city_stat" || e.type === "change_faction_stance" || e.type === "set_faction_vassal",
  );
  const cityDef = hasWorldEffect ? await getCityDefaults() : null;
  const factionDef = hasWorldEffect ? await getFactionDefaults() : null;

  await db.transaction(async (tx) => {
    // The world a world-scoped effect targets is the active world (NOT read from the
    // acting player — keeps these effects reusable by a future player-less trigger).
    const worldId = hasWorldEffect
      ? (await tx.select({ id: worlds.id }).from(worlds).where(eq(worlds.status, "active")).limit(1))[0]?.id ?? null
      : null;
    for (const effect of choice.effects) {
      switch (effect.type) {
        case "change_stat": {
          const rows = await tx
            .select()
            .from(playerCharacters)
            .where(eq(playerCharacters.id, actingCharacterId))
            .limit(1);
          const row = rows[0];
          if (!row) break;
          const applied = applyStatGrowth(effect.amount, Number(row.growthMultiplier));
          // Hard-cap every stat write to [0,100] (the CHECK constraint enforces it).
          const next = capStat(row[effect.stat] + applied, getAgeConfig());
          await tx.update(playerCharacters).set({ [effect.stat]: next }).where(eq(playerCharacters.id, actingCharacterId));
          await tx.insert(effectLog).values({ characterId: actingCharacterId, kind: "change_stat", detail: { stat: effect.stat, requested: effect.amount, applied } });
          break;
        }
        case "change_ideology": {
          const target = effect.characterId ?? actingCharacterId;
          const rows = await tx.select({ ideology: playerCharacters.ideology }).from(playerCharacters).where(eq(playerCharacters.id, target)).limit(1);
          if (!rows[0]) break;
          const next = clampIdeology(rows[0].ideology + effect.amount);
          await tx.update(playerCharacters).set({ ideology: next }).where(eq(playerCharacters.id, target));
          await tx.insert(effectLog).values({ characterId: target, kind: "change_ideology", detail: { amount: effect.amount, value: next } });
          if (target === actingCharacterId) ideologyTouched = true;
          break;
        }
        case "change_drachmae": {
          const rows = await tx.select({ drachmae: playerCharacters.drachmae }).from(playerCharacters).where(eq(playerCharacters.id, actingCharacterId)).limit(1);
          if (!rows[0]) break;
          const next = Math.max(0, rows[0].drachmae + effect.amount);
          await tx.update(playerCharacters).set({ drachmae: next }).where(eq(playerCharacters.id, actingCharacterId));
          await tx.insert(effectLog).values({ characterId: actingCharacterId, kind: "change_drachmae", detail: { amount: effect.amount, value: next } });
          break;
        }
        case "change_party_favor": {
          await tx
            .insert(partyFavor)
            .values({ characterId: actingCharacterId, party: effect.party, favor: effect.amount })
            .onConflictDoUpdate({
              target: [partyFavor.characterId, partyFavor.party],
              set: { favor: sql`${partyFavor.favor} + ${effect.amount}` },
            });
          await tx.insert(effectLog).values({ characterId: actingCharacterId, kind: "change_party_favor", detail: { party: effect.party, amount: effect.amount } });
          break;
        }
        case "gain_resource":
          await tx.insert(effectLog).values({ characterId: actingCharacterId, kind: "gain_resource", detail: { ...effect } });
          break;
        case "set_province_owner":
          setProvinceOwner(effect.provinceId, resolveOwnerToken(effect.ownerPlayerId));
          break;
        // --- World-scoped effects (Atlas Phase 2b-ii) --------------------------
        // Explicitly-targeted (target is in the payload, never the acting player).
        // Ensure-on-read from content defaults, apply the CLAMPED change via the
        // typed table, log under the triggering character with the world target +
        // before/after in detail. An unknown id is skipped + warned (a bad content
        // id must not blow up the player's whole resolution).
        case "change_city_stat": {
          if (!worldId || !cityDef) break;
          const def = cityDef.get(effect.cityId);
          if (!def) {
            console.warn(`change_city_stat: unknown cityId "${effect.cityId}" — skipped`);
            break;
          }
          await tx.insert(leagueCities).values({ worldId, cityId: effect.cityId, ...def }).onConflictDoNothing();
          const rows = await tx
            .select()
            .from(leagueCities)
            .where(and(eq(leagueCities.worldId, worldId), eq(leagueCities.cityId, effect.cityId)))
            .limit(1);
          const row = rows[0];
          if (!row) break;
          const next = applyCityStat(effect.stat, row[effect.stat], effect.amount);
          await tx.update(leagueCities).set({ [effect.stat]: next }).where(eq(leagueCities.id, row.id));
          await tx.insert(effectLog).values({
            characterId: actingCharacterId,
            kind: "change_city_stat",
            detail: { cityId: effect.cityId, stat: effect.stat, amount: effect.amount, from: row[effect.stat], to: next, source: "event", eventId },
          });
          break;
        }
        case "change_faction_stance": {
          if (!worldId || !factionDef) break;
          const def = factionDef.get(effect.factionId);
          if (!def) {
            console.warn(`change_faction_stance: unknown factionId "${effect.factionId}" — skipped`);
            break;
          }
          await tx
            .insert(factionRelations)
            .values({ worldId, factionId: effect.factionId, stance: opinionBand(def.opinion).id, opinion: def.opinion, atWar: def.atWar, allied: def.allied, vassal: def.vassal })
            .onConflictDoNothing();
          const rows = await tx
            .select()
            .from(factionRelations)
            .where(and(eq(factionRelations.worldId, worldId), eq(factionRelations.factionId, effect.factionId)))
            .limit(1);
          const row = rows[0];
          if (!row) break;
          // `amount` is now POINTS of opinion (not rungs). Reaching ±200 does NOT
          // latch the at_war/allied flag in D1 — declaring war/alliance is a later
          // action; opinion can sit at the edge with the flag false.
          const next = applyOpinion(row.opinion, effect.amount);
          await tx
            .update(factionRelations)
            .set({ opinion: next, stance: opinionBand(next).id })
            .where(eq(factionRelations.id, row.id));
          await tx.insert(effectLog).values({
            characterId: actingCharacterId,
            kind: "change_faction_stance",
            detail: { factionId: effect.factionId, amount: effect.amount, from: row.opinion, to: next, source: "event", eventId },
          });
          break;
        }
        case "set_faction_vassal": {
          if (!worldId || !factionDef) break;
          const def = factionDef.get(effect.factionId);
          if (!def) {
            console.warn(`set_faction_vassal: unknown factionId "${effect.factionId}" — skipped`);
            break;
          }
          await tx
            .insert(factionRelations)
            .values({ worldId, factionId: effect.factionId, stance: opinionBand(def.opinion).id, opinion: def.opinion, atWar: def.atWar, allied: def.allied, vassal: def.vassal })
            .onConflictDoNothing();
          await tx
            .update(factionRelations)
            .set({ vassal: effect.vassal })
            .where(and(eq(factionRelations.worldId, worldId), eq(factionRelations.factionId, effect.factionId)));
          await tx.insert(effectLog).values({
            characterId: actingCharacterId,
            kind: "set_faction_vassal",
            detail: { factionId: effect.factionId, vassal: effect.vassal, source: "event", eventId },
          });
          break;
        }
        case "change_composure":
        case "change_trait":
        case "spawn_army":
          // handled outside the tx (services) or not persisted yet
          break;
      }
    }
    // Record the resolution in history (also recorded at draw time).
    await tx.insert(eventHistory).values({ characterId: actingCharacterId, eventId });
  });

  // Rule-enforcing trait changes (idempotent; cap/opposite enforced).
  for (const effect of traitEffects) {
    if (effect.type !== "change_trait") continue;
    try {
      await applyChangeTrait(effect.characterId ?? actingCharacterId, effect.traitId, effect.operation);
    } catch (error) {
      if (!(error instanceof TraitRuleError)) throw error;
      console.warn(`change_trait skipped (${error.reason}): ${error.message}`);
    }
  }

  if (ideologyTouched) await onIdeologyChanged(actingCharacterId);
  await broadcastState();

  return { resultText: choice.resultText };
}

export async function recordDraw(characterId: string, eventId: string) {
  await db.insert(eventHistory).values({ characterId, eventId });
}

export async function recentEventIds(characterId: string, limit = 5): Promise<string[]> {
  const rows = await db
    .select({ eventId: eventHistory.eventId })
    .from(eventHistory)
    .where(eq(eventHistory.characterId, characterId))
    .orderBy(sql`${eventHistory.createdAt} desc`)
    .limit(limit);
  return rows.map((row) => row.eventId);
}
