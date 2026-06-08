import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { clampIdeology, type EventDefinition, type EventEffect } from "@massalia/shared";
import { createDb, playerCharacters } from "@massalia/db";
import { resolveOwnerToken, setProvinceOwner } from "./worldState.js";
import { applyChangeTrait, TraitRuleError } from "./traits.js";
import { onIdeologyChanged } from "./politics.js";

const db = createDb();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../../..");
const eventsDir = path.join(repoRoot, "content/events");

export async function listEvents(): Promise<EventDefinition[]> {
  const files = (await fs.readdir(eventsDir)).filter((file) => file.endsWith(".json"));
  return Promise.all(files.map((file) => fs.readFile(path.join(eventsDir, file), "utf8").then((content) => JSON.parse(content))));
}

export async function applyEventChoice(eventId: string, choiceId: string) {
  const events = await listEvents();
  const event = events.find((candidate) => candidate.id === eventId);
  if (!event) throw new Error(`Unknown event ${eventId}`);
  const choice = event.choices.find((candidate) => candidate.id === choiceId);
  if (!choice) throw new Error(`Unknown choice ${choiceId}`);

  // Characters whose ideology changed this batch; drift-checked once at the end.
  const ideologyTouched = new Set<string>();
  for (const effect of choice.effects) {
    const touched = await applyEffect(effect);
    if (touched) ideologyTouched.add(touched);
  }

  // Single hook: run the ideology drift / censure check after the effect batch.
  for (const characterId of ideologyTouched) {
    await onIdeologyChanged(characterId);
  }

  return {
    eventId,
    choiceId,
    resultText: choice.resultText,
  };
}

// Returns the characterId whose ideology changed (for the post-batch drift hook).
async function applyEffect(effect: EventEffect): Promise<string | void> {
  switch (effect.type) {
    case "set_province_owner":
      setProvinceOwner(effect.provinceId, resolveOwnerToken(effect.ownerPlayerId));
      return;
    case "change_trait":
      // Route through the rule-enforcing trait service. A rule violation (e.g.
      // personality cap) is logged and skipped rather than failing the event.
      try {
        await applyChangeTrait(effect.characterId, effect.traitId, effect.operation);
      } catch (error) {
        if (!(error instanceof TraitRuleError)) throw error;
        console.warn(`change_trait skipped (${error.reason}): ${error.message}`);
      }
      return;
    case "change_ideology": {
      const rows = await db
        .select({ ideology: playerCharacters.ideology })
        .from(playerCharacters)
        .where(eq(playerCharacters.id, effect.characterId))
        .limit(1);
      if (!rows[0]) return;
      const next = clampIdeology(rows[0].ideology + effect.amount);
      await db.update(playerCharacters).set({ ideology: next }).where(eq(playerCharacters.id, effect.characterId));
      return effect.characterId;
    }
    case "gain_resource":
    case "spawn_army":
      // TODO: Persist and validate these effects through transactional game services.
      return;
  }
}
