import { and, eq, isNull } from "drizzle-orm";
import {
  adoptionWomenOnly,
  canMarry,
  generateCandidates,
  isFamilyLocked,
  type AgeConfig,
  type FamilyConfig,
} from "@massalia/shared";
import { createDb } from "./client.js";
import { familyCandidates, houses, playerCharacters } from "./schema.js";

const db = createDb();

export type FamilyCandidateRow = typeof familyCandidates.$inferSelect;

type DrawArgs = { familyCfg: FamilyConfig; ageCfg: AgeConfig; now?: Date };

// Draw a fresh per-player candidate set. Used by BOTH the BullMQ worker
// (scheduled yearly) and the server (lazy-on-read), like resolveCensureIfExpired.
// New draws REPLACE the character's unconsumed candidates of that purpose so the
// offer stays fresh; consumed (chosen) rows are left for history.
//
// Prompt A surfaces marriage candidates for unmarried citizens, and women-only
// adoption candidates for the hetaira (her only family path). Citizen adoption +
// children/heirs arrive with the succession pack.
export async function drawFamilyCandidates(characterId: string, args: DrawArgs): Promise<FamilyCandidateRow[]> {
  const { familyCfg, ageCfg } = args;
  const charRows = await db.select().from(playerCharacters).where(eq(playerCharacters.id, characterId)).limit(1);
  const character = charRows[0];
  if (!character) return [];
  if (isFamilyLocked(character.classId, familyCfg)) return []; // slave: nothing is drawn

  const houseRows = await db.select({ slug: houses.slug, ideology: houses.startIdeology }).from(houses);
  const avatarIds = ageCfg.avatars.map((avatar) => avatar.id);
  const pickAvatar = () => (avatarIds.length ? avatarIds[Math.floor(Math.random() * avatarIds.length)]! : null);

  const purposes: { purpose: "marriage" | "adoption"; count: number; womenOnly: boolean }[] = [];
  if (canMarry(character.classId, familyCfg) && !character.spouseCandidateId) {
    purposes.push({ purpose: "marriage", count: familyCfg.candidates.perDraw, womenOnly: false });
  }
  if (character.classId === "hetaira") {
    purposes.push({ purpose: "adoption", count: familyCfg.adoption.perDraw, womenOnly: adoptionWomenOnly(character.classId, familyCfg) });
  }

  const inserted: FamilyCandidateRow[] = [];
  for (const { purpose, count, womenOnly } of purposes) {
    const drafts = generateCandidates(Math.random, purpose, count, familyCfg, houseRows, womenOnly);
    // Replace this purpose's unconsumed offers with the fresh draw.
    await db
      .delete(familyCandidates)
      .where(and(eq(familyCandidates.forCharacterId, characterId), eq(familyCandidates.purpose, purpose), isNull(familyCandidates.consumedAt)));
    for (const draft of drafts) {
      const rows = await db
        .insert(familyCandidates)
        .values({
          worldId: character.worldId,
          forCharacterId: characterId,
          purpose: draft.purpose,
          name: draft.name,
          sex: draft.sex,
          houseSlug: draft.houseSlug,
          age: draft.age,
          prestige: draft.prestige,
          devotion: draft.devotion,
          militia: draft.militia,
          intelligence: draft.intelligence,
          traitId: draft.traitId,
          // Art is generic male placeholders for now; pick any adult avatar (matched
          // to sex once female art lands — see content/age avatars).
          avatarId: pickAvatar(),
          ideology: draft.ideology,
        })
        .returning();
      inserted.push(rows[0]!);
    }
  }
  return inserted;
}
