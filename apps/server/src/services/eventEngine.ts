import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { EventDefinition, EventEffect } from "@massalia/shared";
import { resolveOwnerToken, setProvinceOwner } from "./worldState.js";
import { applyChangeTrait, TraitRuleError } from "./traits.js";

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

  for (const effect of choice.effects) {
    await applyEffect(effect);
  }

  return {
    eventId,
    choiceId,
    resultText: choice.resultText,
  };
}

async function applyEffect(effect: EventEffect) {
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
    case "gain_resource":
    case "spawn_army":
      // TODO: Persist and validate these effects through transactional game services.
      return;
  }
}
