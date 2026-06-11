import { eq } from "drizzle-orm";
import { createDb, effectLog, players, playerCharacters } from "@massalia/db";
import {
  canManumit,
  capStat,
  CLASS_START,
  isManumissionTarget,
  manumissionChoices,
  type ClassId,
  type StatBonus,
} from "@massalia/shared";
import { getFamilyConfig } from "./family.js";
import { getAgeConfig } from "./age.js";
import { getHeldTraits } from "./traits.js";
import { broadcastState } from "./worldState.js";

const db = createDb();

type CharacterRow = typeof playerCharacters.$inferSelect;

// A one-line flavour of each citizen life (code, like the name banks — not tuning).
const CLASS_FLAVOR: Record<string, { name: string; flavor: string }> = {
  landowner: { name: "Landowner", flavor: "Wheat fields and a name on the land — the slow, sure wealth of soil." },
  trader: { name: "Trader", flavor: "Wine, risk, and the harbor's churn — fortunes made on a good crossing." },
  philosopher: { name: "Philosopher", flavor: "The Stoa and the scroll — influence won by the sharpened mind." },
  hoplite: { name: "Hoplite", flavor: "Shield, spear, and the phalanx — honor earned at the city's edge." },
  shipbuilder: { name: "Shipbuilder", flavor: "Keel and timber — the yards that carry Massalia's trade." },
  priest: { name: "Priest", flavor: "The altar and the god's favor — devotion the city heeds." },
};

function manumissionCfg() {
  return getFamilyConfig().manumission;
}

async function heldTraitIds(characterId: string): Promise<string[]> {
  return (await getHeldTraits(characterId)).map((trait) => trait.id);
}

// me/state flag: is this character a slave who has earned the path out?
export async function manumissionStatus(character: CharacterRow): Promise<{ eligible: boolean }> {
  const eligible = canManumit(character.classId, await heldTraitIds(character.id), manumissionCfg());
  return { eligible };
}

export interface ManumissionChoice {
  classId: string;
  name: string;
  flavor: string;
  bonus: StatBonus;
}

// GET /api/manumission: eligibility + the citizen classes to choose, each with a
// preview of its starting stat bonus (the grant applied on the switch).
export async function manumissionOptions(character: CharacterRow): Promise<{ eligible: boolean; choices: ManumissionChoice[] }> {
  const cfg = manumissionCfg();
  const eligible = canManumit(character.classId, await heldTraitIds(character.id), cfg);
  const choices: ManumissionChoice[] = manumissionChoices(cfg).map((classId) => ({
    classId,
    name: CLASS_FLAVOR[classId]?.name ?? classId,
    flavor: CLASS_FLAVOR[classId]?.flavor ?? "",
    bonus: CLASS_START[classId as ClassId]?.bonus ?? {},
  }));
  return { eligible, choices };
}

export type ManumitResult =
  | { ok: false; code: number; error: string }
  | { ok: true; classId: string; className: string; bonus: StatBonus };

// POST /api/manumission: buy into a citizen class. Validates eligibility AND the
// target, then in one transaction switches classId and grants the new class's
// starting stat bonus (capped at the stat ceiling). The freedman trait is KEPT as
// a permanent badge of origin; eligibility is gated on classId === "slave", so
// once a citizen the character can never re-trigger manumission.
export async function manumit(character: CharacterRow, classId: string): Promise<ManumitResult> {
  const cfg = manumissionCfg();
  if (!canManumit(character.classId, await heldTraitIds(character.id), cfg)) {
    return { ok: false, code: 409, error: "You are not eligible for manumission." };
  }
  if (!isManumissionTarget(classId, cfg)) {
    return { ok: false, code: 409, error: "A freedman cannot buy into that class." };
  }

  const ageCfg = getAgeConfig();
  const bonus = CLASS_START[classId as ClassId]?.bonus ?? {};

  await db.transaction(async (tx) => {
    const row = (await tx.select().from(playerCharacters).where(eq(playerCharacters.id, character.id)).limit(1))[0];
    if (!row) throw new Error("Character vanished mid-manumission.");
    // Same person: keep stats/traits/age/composure/drachmae; add the class bonus,
    // clamped to the stat cap. Only the class and those stats change.
    const next = {
      classId,
      prestige: capStat(row.prestige + (bonus.prestige ?? 0), ageCfg),
      devotion: capStat(row.devotion + (bonus.devotion ?? 0), ageCfg),
      militia: capStat(row.militia + (bonus.militia ?? 0), ageCfg),
      intelligence: capStat(row.intelligence + (bonus.intelligence ?? 0), ageCfg),
    };
    await tx.update(playerCharacters).set(next).where(eq(playerCharacters.id, character.id));
    // Keep the display profession in sync with the live classId (me/state reads
    // players.professionSlug for the character sheet, resource, and rank).
    await tx.update(players).set({ professionSlug: classId }).where(eq(players.id, character.playerId));
    await tx.insert(effectLog).values({ characterId: character.id, kind: "manumission", detail: { from: character.classId, to: classId, bonus } });
  });

  await broadcastState();
  return { ok: true, classId, className: CLASS_FLAVOR[classId]?.name ?? classId, bonus };
}
