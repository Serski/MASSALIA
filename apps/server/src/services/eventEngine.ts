import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { eq, sql } from "drizzle-orm";
import {
  applyStatGrowth,
  clampIdeology,
  parseEventFile,
  type EventChoice,
  type EventDefinition,
} from "@massalia/shared";
import { createDb, effectLog, eventHistory, partyFavor, playerCharacters } from "@massalia/db";
import { broadcastState, resolveOwnerToken, setProvinceOwner } from "./worldState.js";
import { applyChangeTrait, TraitRuleError } from "./traits.js";
import { onIdeologyChanged } from "./politics.js";

const db = createDb();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../../..");
const eventsDir = path.join(repoRoot, "content/events");

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

  await db.transaction(async (tx) => {
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
          const next = Math.max(0, row[effect.stat] + applied);
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
