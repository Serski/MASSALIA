import { beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { REAL_MS_PER_SEASON } from "@massalia/shared";

// ---------------------------------------------------------------------------
// olympiadStatus champion-headline window (integration; *_test DB only). The
// city-wide champion headline must show for ONE real day after the crowning, not
// the whole multi-day `completed` phase. Time is real Date.now(); we backdate the
// cycle's payoffAt to land the crowning inside or outside that one-day window.
// ---------------------------------------------------------------------------

const dbUrl = process.env.DATABASE_URL ?? "";
const suite = describe.runIf(dbUrl.includes("_test"));

async function loadModules() {
  const dbPkg = await import("@massalia/db");
  const age = await import("./age.js");
  const traits = await import("./traits.js");
  const festival = await import("./festival.js");
  const olympiad = await import("./olympiad.js");
  return { dbPkg, age, traits, festival, olympiad };
}

suite("olympiadStatus champion headline window (integration)", () => {
  let m: Awaited<ReturnType<typeof loadModules>>;
  let db: ReturnType<Awaited<ReturnType<typeof loadModules>>["dbPkg"]["createDb"]>;
  let worldId: string;
  let characterRow: typeof import("@massalia/db").playerCharacters.$inferSelect;
  const now = new Date();

  beforeAll(async () => {
    m = await loadModules();
    db = m.dbPkg.createDb();
    await m.age.loadAgeConfig();
    await m.traits.loadTraitDefs();
    await m.festival.loadCalendarConfig();

    await db.execute(sql`
      TRUNCATE TABLE olympiads, character_traits, player_characters, players, sessions, users, worlds CASCADE
    `);
    await db.insert(m.dbPkg.houses).values({
      slug: "oly-house", name: "Oly House", initial: "O", alignment: "centrist",
      stance: "s", motto: "m", patron: "p", crest: "c",
    }).onConflictDoNothing();
    const world = (
      await db.insert(m.dbPkg.worlds).values({
        name: "Oly World", seed: "oly", startedAt: now, endsAt: new Date(now.getTime() + 182 * 86_400_000), status: "active",
      }).returning()
    )[0]!;
    worldId = world.id;

    const user = (await db.insert(m.dbPkg.users).values({ email: `oly-${Math.random().toString(36).slice(2)}@t`, passwordHash: "x" }).returning())[0]!;
    const player = (await db.insert(m.dbPkg.players).values({ worldId, userId: user.id, name: "Nikias", color: "#111" }).returning())[0]!;
    characterRow = (
      await db.insert(m.dbPkg.playerCharacters).values({ playerId: player.id, worldId, houseSlug: "oly-house", classId: "landowner", startAge: 30, deathAge: 90 }).returning()
    )[0]!;
    // The city's crowned Olympionikes, crowned "now".
    await db.insert(m.dbPkg.characterTraits).values({ characterId: characterRow.id, traitId: "olympionikes", gainedAt: now });
  });

  // Replace the single completed cycle with a given payoff instant, then read the
  // derived champion off olympiadStatus.
  async function championAtPayoff(payoffAt: Date) {
    await db.delete(m.dbPkg.olympiads).where(eq(m.dbPkg.olympiads.worldId, worldId));
    await db.insert(m.dbPkg.olympiads).values({ worldId, gameYear: 8, phase: "completed", payoffAt });
    const status = await m.olympiad.olympiadStatus(characterRow);
    return status?.champion ?? null;
  }

  it("champion shows within one real day of the crowning", async () => {
    const champ = await championAtPayoff(new Date(now.getTime() - REAL_MS_PER_SEASON / 2)); // half a day ago
    expect(champ).toEqual({ name: "Nikias" });
  });

  it("champion is gone once the day has passed (the completed phase lingers, the headline does not)", async () => {
    const champ = await championAtPayoff(new Date(now.getTime() - 2 * REAL_MS_PER_SEASON)); // two days ago
    expect(champ).toBeNull();
  });
});
