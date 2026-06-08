import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { and, eq } from "drizzle-orm";
import { characterTraits, createDb } from "@massalia/db";
import { canAddTrait, parseTraitsFile, type AddTraitRejection, type HeldTrait, type Trait } from "@massalia/shared";

const db = createDb();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../../..");
const traitsFile = path.join(repoRoot, "content/traits/traits.json");

let traitIndex: Map<string, Trait> | null = null;

// Read + validate content/traits/traits.json. Called at server boot so an
// invalid file fails fast; memoized thereafter.
export async function loadTraitDefs(): Promise<Map<string, Trait>> {
  const raw = await fs.readFile(traitsFile, "utf8");
  const traits = parseTraitsFile(JSON.parse(raw));
  traitIndex = new Map(traits.map((trait) => [trait.id, trait]));
  return traitIndex;
}

function defs(): Map<string, Trait> {
  if (!traitIndex) throw new Error("Trait definitions not loaded. Call loadTraitDefs() at boot.");
  return traitIndex;
}

export function getTraitDef(id: string): Trait | undefined {
  return defs().get(id);
}

export class TraitRuleError extends Error {
  reason: AddTraitRejection | "unknown_trait";
  statusCode: number;
  constructor(reason: AddTraitRejection | "unknown_trait", message: string) {
    super(message);
    this.reason = reason;
    this.statusCode = reason === "unknown_trait" ? 400 : 409;
  }
}

type HeldRow = { traitId: string; gainedAt: Date };

async function heldRows(characterId: string): Promise<HeldRow[]> {
  return db
    .select({ traitId: characterTraits.traitId, gainedAt: characterTraits.gainedAt })
    .from(characterTraits)
    .where(eq(characterTraits.characterId, characterId));
}

// Resolved trait definitions the character holds (unknown ids dropped), with gainedAt.
export async function getHeldTraits(characterId: string): Promise<HeldTrait[]> {
  const rows = await heldRows(characterId);
  const out: HeldTrait[] = [];
  for (const row of rows) {
    const def = defs().get(row.traitId);
    if (def) out.push({ ...def, gainedAt: row.gainedAt.toISOString() });
  }
  return out;
}

// Add a trait, enforcing cap + opposite rules. Idempotent on an already-held
// trait. Throws TraitRuleError on a rule violation or unknown trait.
export async function addTrait(characterId: string, traitId: string): Promise<void> {
  const candidate = defs().get(traitId);
  if (!candidate) throw new TraitRuleError("unknown_trait", `Unknown trait: ${traitId}`);

  const held = await getHeldTraits(characterId);
  if (held.some((trait) => trait.id === traitId)) return; // idempotent

  const verdict = canAddTrait(held, candidate);
  if (!verdict.ok) {
    const message =
      verdict.reason === "personality_cap"
        ? "A character may hold at most 3 personality traits."
        : verdict.reason === "opposite"
          ? `Cannot add ${candidate.name}: the character holds its opposite.`
          : `The character already has ${candidate.name}.`;
    throw new TraitRuleError(verdict.reason, message);
  }

  await db.insert(characterTraits).values({ characterId, traitId }).onConflictDoNothing();
}

export async function removeTrait(characterId: string, traitId: string): Promise<void> {
  await db
    .delete(characterTraits)
    .where(and(eq(characterTraits.characterId, characterId), eq(characterTraits.traitId, traitId)));
}

// Route a change_trait event effect through the rule-enforcing service.
export async function applyChangeTrait(characterId: string, traitId: string, operation: "add" | "remove"): Promise<void> {
  if (operation === "add") await addTrait(characterId, traitId);
  else await removeTrait(characterId, traitId);
}
