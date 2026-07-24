import { and, eq } from "drizzle-orm";
import { createDb, dynasties, players, playerCharacters, worlds } from "@massalia/db";
import {
  capStat,
  CLASS_START,
  currentAge,
  effectiveStats,
  HOUSE_START,
  isDeceased,
  isWithdrawn,
  lifeStage,
  portraitFor,
  rollDeathAge,
  startAgeForAvatar,
  startBonusForAge,
  startingCharacter,
  type CharacterSheet,
  type CharacterStats,
  type ClassId,
  type HeldTrait,
  type Party,
} from "@massalia/shared";
import { getComposureConfig } from "./composure.js";
import { getAgeConfig, portraitUrl } from "./age.js";

const db = createDb();

export type CharacterRow = typeof playerCharacters.$inferSelect;
export type PlayerRow = typeof players.$inferSelect;

export async function getActiveWorldId(): Promise<string | null> {
  const rows = await db.select({ id: worlds.id }).from(worlds).where(eq(worlds.status, "active")).limit(1);
  return rows[0]?.id ?? null;
}

// The active world's id + start instant (ms). The start instant feeds gameDate()
// for season derivation (e.g. the family arena's winter check).
export async function getActiveWorld(): Promise<{ id: string; startedMs: number } | null> {
  const rows = await db.select({ id: worlds.id, startedAt: worlds.startedAt }).from(worlds).where(eq(worlds.status, "active")).limit(1);
  const world = rows[0];
  return world ? { id: world.id, startedMs: world.startedAt.getTime() } : null;
}

export async function getActivePlayer(userId: string, worldId: string): Promise<PlayerRow | null> {
  const rows = await db
    .select()
    .from(players)
    .where(and(eq(players.userId, userId), eq(players.worldId, worldId), eq(players.isActive, true)))
    .limit(1);
  return rows[0] ?? null;
}

function safeHouse(slug: string | null | undefined): string {
  return slug && HOUSE_START[slug] ? slug : "xanthippos";
}

function safeClass(slug: string | null | undefined): ClassId {
  return slug && (slug as ClassId) in CLASS_START ? (slug as ClassId) : "trader";
}

export async function findCharacterRow(playerId: string, worldId: string): Promise<CharacterRow | null> {
  const rows = await db
    .select()
    .from(playerCharacters)
    .where(and(eq(playerCharacters.playerId, playerId), eq(playerCharacters.worldId, worldId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function createCharacterRow(
  playerId: string,
  worldId: string,
  houseId: string,
  classId: ClassId,
  avatarId = "avatar-30-1",
  now: Date = new Date(),
): Promise<CharacterRow> {
  const start = startingCharacter(houseId, classId);
  // Starting composure is config-driven (composure-config.json), not a literal.
  const startingComposure = getComposureConfig().startingComposure ?? start.composure;

  // Age pack: the avatar fixes the start age (20 or 30); apply that age's start
  // bonus on top of house+class, then hard-cap each stat. Roll the death age.
  const ageCfg = getAgeConfig();
  const startAge = startAgeForAvatar(avatarId, ageCfg) ?? 30;
  const bonus = startBonusForAge(startAge, ageCfg);
  const capped = (key: keyof CharacterStats) => capStat(start[key] + (bonus[key] ?? 0), ageCfg);

  // The dynasty spine (Prompt C): every character founds/continues a dynasty.
  const dynasty = (await db
    .insert(dynasties)
    .values({ worldId, name: `House ${houseId}`, houseSlug: houseId, foundingPlayerId: playerId, generation: 1 })
    .returning())[0]!;

  const inserted = await db
    .insert(playerCharacters)
    .values({
      dynastyId: dynasty.id,
      playerId,
      worldId,
      houseSlug: houseId,
      classId,
      // Hoplite Step 5: the persistent veteran signal, preserved through re-class.
      wasHoplite: classId === "hoplite",
      prestige: capped("prestige"),
      devotion: capped("devotion"),
      militia: capped("militia"),
      intelligence: capped("intelligence"),
      drachmae: start.drachmae,
      ideology: start.ideology,
      party: start.party,
      composure: startingComposure,
      growthMultiplier: String(start.growthMultiplier),
      avatarId,
      startAge,
      deathAge: rollDeathAge(ageCfg),
      lastDecayAt: now,
      // Family pack: hetaira are women; everyone else reads male until new avatars.
      sex: classId === "hetaira" ? "female" : "male",
    })
    .returning();
  return inserted[0]!;
}

// Fetch the player's sheet, auto-provisioning from their house + profession if
// they predate this table (legacy players + seed characters).
export async function ensureCharacterRow(player: PlayerRow, worldId: string): Promise<CharacterRow> {
  const existing = await findCharacterRow(player.id, worldId);
  if (existing) return existing;
  return createCharacterRow(player.id, worldId, safeHouse(player.houseSlug), safeClass(player.professionSlug));
}

export function toCharacterSheet(
  row: CharacterRow,
  traits: HeldTrait[] = [],
  censureExpiresAt: string | null = null,
  now: Date = new Date(),
): CharacterSheet {
  const base: CharacterStats = {
    prestige: row.prestige,
    devotion: row.devotion,
    militia: row.militia,
    intelligence: row.intelligence,
  };
  const ageCfg = getAgeConfig();
  // The 100 cap is a true ceiling: clamp derived (base + trait statMods) too.
  const raw = effectiveStats(base, traits);
  const effective: CharacterStats = {
    prestige: capStat(raw.prestige, ageCfg),
    devotion: capStat(raw.devotion, ageCfg),
    militia: capStat(raw.militia, ageCfg),
    intelligence: capStat(raw.intelligence, ageCfg),
  };

  const age = currentAge(row.startAge, row.createdAt.getTime(), now.getTime(), ageCfg);
  // TODO: succession pack wires death -> heir/adoption; deceased is display-only.
  const deceased = row.deathAge !== null ? isDeceased(age, row.deathAge) : false;

  return {
    id: row.id,
    playerId: row.playerId,
    worldId: row.worldId,
    houseId: row.houseSlug,
    classId: row.classId as ClassId,
    base,
    // Derived on read: base + trait statMods, clamped to the cap. Never persisted.
    effective,
    drachmae: row.drachmae,
    ideology: row.ideology,
    party: row.party as Party,
    composure: row.composure,
    withdrawn: isWithdrawn(row.breakUntil, now),
    growthMultiplier: Number(row.growthMultiplier),
    createdAt: row.createdAt.toISOString(),
    traits,
    censured: censureExpiresAt !== null,
    censureExpiresAt,
    avatarId: row.avatarId,
    startAge: row.startAge,
    currentAge: age,
    lifeStage: lifeStage(age, ageCfg),
    portrait: portraitUrl(portraitFor(row.avatarId ?? "", age, ageCfg)),
    deceased,
  };
}
