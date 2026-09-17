import { and, eq, inArray } from "drizzle-orm";
import {
  festivalById,
  festivalSeasonOfYear,
  festivalsFiringAt,
  gameDate,
  type CalendarConfig,
  type Festival,
} from "@massalia/shared";
import { createDb } from "./client.js";
import { characterTraits, festivalChoregos, festivalDonations, festivalEvents, playerCharacters, players, worlds } from "./schema.js";

const db = createDb();

// DB-level festival lifecycle, shared by the server (lazy-on-read) and the BullMQ
// worker (scheduled sweep) — like the family rolls. Config is passed in; the
// choregos trait is unconstrained (reputation), so it is granted/stripped directly.
//
// Festivals are per world. game_year restarts with every world, so every read and
// write below is scoped to the active world: the close guard by its world_id, cards
// and donations through their character's world.

async function activeWorld(): Promise<{ id: string; startedMs: number } | null> {
  const rows = await db.select({ id: worlds.id, startedAt: worlds.startedAt }).from(worlds).where(eq(worlds.status, "active")).limit(1);
  return rows[0] ? { id: rows[0].id, startedMs: rows[0].startedAt.getTime() } : null;
}

export async function worldStartedMs(): Promise<number | null> {
  return (await activeWorld())?.startedMs ?? null;
}

// The active world's characters, as a subquery for IN (...).
const charactersOf = (worldId: string) => db.select({ id: playerCharacters.id }).from(playerCharacters).where(eq(playerCharacters.worldId, worldId));

async function deliver(worldId: string, characterId: string, festival: Festival, gameYear: number): Promise<void> {
  const closed = await db
    .select({ id: festivalChoregos.id })
    .from(festivalChoregos)
    .where(and(eq(festivalChoregos.worldId, worldId), eq(festivalChoregos.festivalId, festival.id), eq(festivalChoregos.gameYear, gameYear)))
    .limit(1);
  if (closed.length > 0) return;
  await db
    .insert(festivalEvents)
    .values({ characterId, festivalId: festival.id, eventId: festival.eventId, gameYear, resolved: false })
    .onConflictDoNothing();
}

// Deliver any festival firing now to a single living character of the active world.
export async function fireFestivalsForCharacterId(characterId: string, cfg: CalendarConfig, now: Date = new Date()): Promise<void> {
  const world = await activeWorld();
  if (!world) return;
  const rows = await db.select({ status: playerCharacters.status, worldId: playerCharacters.worldId }).from(playerCharacters).where(eq(playerCharacters.id, characterId)).limit(1);
  if (rows[0]?.status !== "alive" || rows[0].worldId !== world.id) return;
  const gd = gameDate(now.getTime(), world.startedMs);
  for (const festival of festivalsFiringAt(cfg, gd.seasonOfYear, gd.yearInGame)) {
    await deliver(world.id, characterId, festival, gd.yearInGame);
  }
}

// The global sweep: deliver to every active living character of the active world.
export async function fireFestivalsForAll(cfg: CalendarConfig, now: Date = new Date()): Promise<number> {
  const world = await activeWorld();
  if (!world) return 0;
  const gd = gameDate(now.getTime(), world.startedMs);
  const firing = festivalsFiringAt(cfg, gd.seasonOfYear, gd.yearInGame);
  if (firing.length === 0) return 0;
  const living = await db
    .select({ id: playerCharacters.id })
    .from(playerCharacters)
    .innerJoin(players, eq(players.id, playerCharacters.playerId))
    .where(and(eq(playerCharacters.worldId, world.id), eq(playerCharacters.status, "alive"), eq(players.isActive, true)));
  for (const row of living) {
    for (const festival of firing) await deliver(world.id, row.id, festival, gd.yearInGame);
  }
  return living.length;
}

// Close every donation instance of the active world whose season has passed: crown
// the top donor as the choregos (revoking the prior holder), auto-resolve untouched
// events to "attend", mark closed. Idempotent. Returns the number of instances closed.
export async function closeDueFestivals(cfg: CalendarConfig, now: Date = new Date()): Promise<number> {
  const world = await activeWorld();
  if (!world) return 0;
  const gd = gameDate(now.getTime(), world.startedMs);

  const fromEvents = await db
    .select({ festivalId: festivalEvents.festivalId, gameYear: festivalEvents.gameYear })
    .from(festivalEvents)
    .innerJoin(playerCharacters, eq(playerCharacters.id, festivalEvents.characterId))
    .where(eq(playerCharacters.worldId, world.id));
  const fromDonations = await db
    .select({ festivalId: festivalDonations.festivalId, gameYear: festivalDonations.gameYear })
    .from(festivalDonations)
    .innerJoin(playerCharacters, eq(playerCharacters.id, festivalDonations.characterId))
    .where(eq(playerCharacters.worldId, world.id));
  const closedRows = await db
    .select({ festivalId: festivalChoregos.festivalId, gameYear: festivalChoregos.gameYear })
    .from(festivalChoregos)
    .where(eq(festivalChoregos.worldId, world.id));
  const closedKeys = new Set(closedRows.map((r) => `${r.festivalId}:${r.gameYear}`));

  const instances = new Map<string, { festivalId: string; gameYear: number }>();
  for (const r of [...fromEvents, ...fromDonations]) {
    const key = `${r.festivalId}:${r.gameYear}`;
    if (!closedKeys.has(key)) instances.set(key, { festivalId: r.festivalId, gameYear: r.gameYear });
  }

  let closedCount = 0;
  for (const { festivalId, gameYear } of instances.values()) {
    const festival = festivalById(cfg, festivalId);
    if (!festival || festival.type !== "donation") continue;
    const season = festivalSeasonOfYear(festival);
    const past = gd.yearInGame > gameYear || (gd.yearInGame === gameYear && gd.seasonOfYear > season);
    if (!past) continue;
    await closeInstance(world.id, festival, gameYear);
    closedCount++;
  }
  return closedCount;
}

async function closeInstance(worldId: string, festival: Festival, gameYear: number): Promise<void> {
  const donations = await db
    .select({ characterId: festivalDonations.characterId, amount: festivalDonations.amount, createdAt: festivalDonations.createdAt })
    .from(festivalDonations)
    .innerJoin(playerCharacters, eq(playerCharacters.id, festivalDonations.characterId))
    .where(and(eq(playerCharacters.worldId, worldId), eq(festivalDonations.festivalId, festival.id), eq(festivalDonations.gameYear, gameYear)));
  const totals = new Map<string, { total: number; earliest: number }>();
  for (const d of donations) {
    const prev = totals.get(d.characterId) ?? { total: 0, earliest: d.createdAt.getTime() };
    totals.set(d.characterId, { total: prev.total + d.amount, earliest: Math.min(prev.earliest, d.createdAt.getTime()) });
  }
  // Highest total wins; earliest donation breaks ties.
  const ranked = [...totals.entries()].sort((a, b) => b[1].total - a[1].total || a[1].earliest - b[1].earliest);
  const winner = ranked[0]?.[0] ?? null;

  if (winner && festival.choregosTraitId) {
    // Strip the choregos trait from every prior holder in this world, then crown the winner.
    await db
      .delete(characterTraits)
      .where(and(eq(characterTraits.traitId, festival.choregosTraitId), inArray(characterTraits.characterId, charactersOf(worldId))));
    await db.insert(characterTraits).values({ characterId: winner, traitId: festival.choregosTraitId }).onConflictDoNothing();
  }

  await db
    .update(festivalEvents)
    .set({ resolved: true, resolvedChoiceId: "attend" })
    .where(and(eq(festivalEvents.festivalId, festival.id), eq(festivalEvents.gameYear, gameYear), eq(festivalEvents.resolved, false), inArray(festivalEvents.characterId, charactersOf(worldId))));

  await db.insert(festivalChoregos).values({ worldId, festivalId: festival.id, gameYear, winnerCharacterId: winner }).onConflictDoNothing();
}
