import { beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Oligarchy Chamber integration tests — run against a REAL Postgres. Guarded:
// they only run when DATABASE_URL points at a *_test database (they truncate
// it), e.g.:
//   createdb massalia_test && DATABASE_URL=postgres://postgres:postgres@localhost:5432/massalia_test pnpm db:migrate
//   DATABASE_URL=postgres://postgres:postgres@localhost:5432/massalia_test pnpm --filter @massalia/server test
// Without that env (CI, plain `pnpm -r test`) the suite is skipped.
// ---------------------------------------------------------------------------

const dbUrl = process.env.DATABASE_URL ?? "";
const runs = dbUrl.includes("_test");

const suite = describe.runIf(runs);

// Imports of modules that call createDb() at module scope must stay dynamic so
// the skipped suite never demands a DATABASE_URL.
type Db = Awaited<ReturnType<typeof loadModules>>;
async function loadModules() {
  const dbPkg = await import("@massalia/db");
  const oligarchy = await import("./oligarchy.js");
  const succession = await import("./succession.js");
  const daily = await import("./dailyDecisions.js");
  const age = await import("./age.js");
  const traits = await import("./traits.js");
  const family = await import("./family.js");
  const composure = await import("./composure.js");
  return { dbPkg, oligarchy, succession, daily, age, traits, family, composure };
}

suite("the Oligarchy Chamber (integration)", () => {
  let m: Db;
  let db: ReturnType<Db["dbPkg"]["createDb"]>;
  let worldId: string;
  let startedAt: Date;
  const now = new Date();

  // One fresh character slot (user + player + player_characters row).
  async function createCharacter(name: string, opts: { drachmae?: number; classId?: string; party?: string } = {}) {
    const { users, players, playerCharacters } = m.dbPkg;
    const user = (await db.insert(users).values({ email: `${name}-${Math.random().toString(36).slice(2)}@test`, passwordHash: "x" }).returning())[0]!;
    const player = (await db.insert(players).values({ worldId, userId: user.id, name, color: "#123456", houseSlug: "test-house" }).returning())[0]!;
    const character = (
      await db
        .insert(playerCharacters)
        .values({
          playerId: player.id,
          worldId,
          houseSlug: "test-house",
          classId: opts.classId ?? "trader",
          drachmae: opts.drachmae ?? 500,
          party: opts.party ?? "none",
          startAge: 30,
          deathAge: 90,
        })
        .returning()
    )[0]!;
    return character;
  }

  async function freshRow(id: string) {
    const { playerCharacters } = m.dbPkg;
    return (await db.select().from(playerCharacters).where(eq(playerCharacters.id, id)).limit(1))[0]!;
  }

  beforeAll(async () => {
    m = await loadModules();
    db = m.dbPkg.createDb();

    await m.age.loadAgeConfig();
    await m.traits.loadTraitDefs();
    await m.family.loadFamilyConfig();
    await m.composure.loadComposureConfig();
    const politics = await m.oligarchy.loadPoliticsConfig();

    // A clean slate in the dedicated test database.
    await db.execute(sql`
      TRUNCATE TABLE chamber_ballots, chamber_votes, oligarch_seats, daily_decisions, daily_routines,
        event_history, effect_log, composure_log, character_traits, censures, children, successions,
        marriages, family_candidates, festival_events, festival_donations, festival_choregos,
        olympic_votes, olympic_candidates, olympiads, player_characters, dynasties, players,
        sessions, users, worlds CASCADE
    `);
    await db.insert(m.dbPkg.houses).values({
      slug: "test-house", name: "Test House", initial: "T", alignment: "centrist",
      stance: "test", motto: "test", patron: "test", crest: "test",
    }).onConflictDoNothing();

    startedAt = new Date(now.getTime() - 10 * 60 * 1000); // 10 minutes into Winter, year 0
    const world = (
      await db.insert(m.dbPkg.worlds).values({
        name: "Chamber Test World", seed: `chamber-test`, startedAt,
        endsAt: new Date(now.getTime() + 182 * 86_400_000), status: "active",
      }).returning()
    )[0]!;
    worldId = world.id;
    await m.dbPkg.ensureChamberSeats(worldId, politics.chamber);
  });

  it("seeds 50/50/10 NPC seats + 190 empty for a new world", async () => {
    const { oligarchSeats } = m.dbPkg;
    const seats = await db.select().from(oligarchSeats).where(eq(oligarchSeats.worldId, worldId));
    expect(seats.length).toBe(300);
    const count = (predicate: (s: (typeof seats)[number]) => boolean) => seats.filter(predicate).length;
    expect(count((s) => s.holderType === "npc" && s.npcParty === "palaioi")).toBe(50);
    expect(count((s) => s.holderType === "npc" && s.npcParty === "dynatoi")).toBe(50);
    expect(count((s) => s.holderType === "npc" && s.npcParty === "independent")).toBe(10);
    expect(count((s) => s.holderType === "empty")).toBe(190);
  });

  it("buying a seat deducts 300, takes the lowest empty seat, flips is_councilor", async () => {
    const buyer = await createCharacter("Eutychos", { drachmae: 500 });
    const result = await m.oligarchy.buySeat(buyer, now);
    expect(result).toMatchObject({ ok: true, seatIndex: 110, price: 300 });

    const after = await freshRow(buyer.id);
    expect(after.drachmae).toBe(200);
    expect(after.isCouncilor).toBe(true);

    const seat = await m.oligarchy.seatOf(buyer.id);
    expect(seat?.holderType).toBe("player");
    expect(seat?.seatIndex).toBe(110);
  });

  it("a fresh seat-holder draws the council (cou-*) events in their daily set", async () => {
    const buyer = await createCharacter("Boularchos", { drachmae: 400 });
    expect((await m.oligarchy.buySeat(buyer, now)).ok).toBe(true);
    const row = await freshRow(buyer.id);
    const cards = await m.daily.ensureDailySet(
      row.id,
      { classId: row.classId, party: row.party, isCouncilor: row.isCouncilor, stats: { prestige: 0, devotion: 0, militia: 0, intelligence: 0 }, traitIds: [] },
      now,
    );
    const council = cards.find((card) => card.arena === "council");
    expect(council).toBeDefined();
    expect(council!.eventId.startsWith("cou-")).toBe(true);
  });

  it("rejects slaves, the poor, and double-buyers with 409", async () => {
    const slave = await createCharacter("Doulos", { drachmae: 1000, classId: "slave" });
    expect(await m.oligarchy.buySeat(slave, now)).toMatchObject({ ok: false, code: 409 });

    const poor = await createCharacter("Penes", { drachmae: 299 });
    expect(await m.oligarchy.buySeat(poor, now)).toMatchObject({ ok: false, code: 409 });

    const twice = await createCharacter("Dis", { drachmae: 1000 });
    expect((await m.oligarchy.buySeat(twice, now)).ok).toBe(true);
    expect(await m.oligarchy.buySeat(await freshRow(twice.id), now)).toMatchObject({ ok: false, code: 409 });
    // Still exactly one seat (the unique partial index backs the service check).
    const { oligarchSeats } = m.dbPkg;
    const seats = await db.select().from(oligarchSeats).where(eq(oligarchSeats.characterId, twice.id));
    expect(seats.length).toBe(1);
  });

  it("seat colors follow the holder's CURRENT party — a defector's seat recolors", async () => {
    const buyer = await createCharacter("Metabolos", { drachmae: 400, party: "dynatoi" });
    expect((await m.oligarchy.buySeat(buyer, now)).ok).toBe(true);
    const row = await freshRow(buyer.id);

    const heldIndex = (await m.oligarchy.seatOf(row.id))!.seatIndex;
    let view = await m.oligarchy.chamberView(row);
    let seat = view.seats.find((s) => s.seatIndex === heldIndex)!;
    expect(seat.party).toBe("dynatoi");
    expect(seat.holderName).toBe("Metabolos");

    const { playerCharacters } = m.dbPkg;
    await db.update(playerCharacters).set({ party: "palaioi" }).where(eq(playerCharacters.id, row.id));
    view = await m.oligarchy.chamberView(row);
    seat = view.seats.find((s) => s.holderName === "Metabolos")!;
    expect(seat.party).toBe("palaioi");

    await db.update(playerCharacters).set({ party: "none" }).where(eq(playerCharacters.id, row.id));
    view = await m.oligarchy.chamberView(row);
    seat = view.seats.find((s) => s.holderName === "Metabolos")!;
    expect(seat.party).toBe("independent");
  });

  it("runs a full chamber vote: one per year, ballots changeable while open, favor-sway + NPC blocs at close, locked after", async () => {
    const { chamberVotes, chamberBallots, partyFavor } = m.dbPkg;
    const politics = m.oligarchy.getPoliticsConfig();

    // The yearly sweep opens exactly one vote (idempotent on world+year).
    const opened = await m.dbPkg.openChamberVoteIfDue(politics, now);
    expect(opened).not.toBeNull();
    expect(await m.dbPkg.openChamberVoteIfDue(politics, now)).toBeNull();
    const votes = await db.select().from(chamberVotes).where(eq(chamberVotes.worldId, worldId));
    expect(votes.length).toBe(1);
    expect(votes[0]!.status).toBe("open");
    // Open for one season: closes at the next season boundary on the world clock.
    expect(votes[0]!.closesAt.getTime()).toBe(startedAt.getTime() + 86_400_000);

    // A dynatoi seat-holder with favor 12 (-> sways 2 of the dynatoi swing).
    const voter = await createCharacter("Krites", { drachmae: 400, party: "dynatoi" });
    expect((await m.oligarchy.buySeat(voter, now)).ok).toBe(true);
    const voterRow = await freshRow(voter.id);
    await db.insert(partyFavor).values({ characterId: voter.id, party: "dynatoi", favor: 12 });

    // A non-seat-holder may not vote.
    const bystander = await createCharacter("Idiotes", { drachmae: 100 });
    expect(await m.oligarchy.castChamberBallot(bystander, "yes", now)).toMatchObject({ ok: false, code: 403 });

    // One ballot per voter, changeable while open.
    expect(await m.oligarchy.castChamberBallot(voterRow, "yes", now)).toMatchObject({ ok: true, choice: "yes" });
    expect(await m.oligarchy.castChamberBallot(voterRow, "no", now)).toMatchObject({ ok: true, choice: "no" });
    const ballots = await db.select().from(chamberBallots).where(eq(chamberBallots.voteId, opened!.id));
    expect(ballots.length).toBe(1);
    expect(ballots[0]!.choice).toBe("no");

    // Auto-close one season later. Year-0 question: harbor-tariff
    // (palaioi no / dynatoi yes / independent yes). The voter's 12 favor sways 2
    // dynatoi swing NPCs to 'no' (their own party, their voted side):
    // yes = 48 dynatoi + 10 independent = 58; no = 50 palaioi + 2 swayed + 1 ballot = 53.
    const afterSeason = new Date(startedAt.getTime() + 86_400_000 + 1000);
    const closes = await m.dbPkg.closeDueChamberVotes(politics, afterSeason);
    expect(closes).toEqual([
      { voteId: opened!.id, gameYear: 0, title: opened!.title, yes: 58, no: 53, passed: true },
    ]);
    const closed = (await db.select().from(chamberVotes).where(eq(chamberVotes.id, opened!.id)))[0]!;
    expect(closed.status).toBe("passed");
    expect(closed.yesCount).toBe(58);
    expect(closed.noCount).toBe(53);
    // Idempotent: a second sweep closes nothing.
    expect(await m.dbPkg.closeDueChamberVotes(politics, afterSeason)).toEqual([]);

    // Locked after close — and still year 0, so no second vote reopens.
    expect(await m.oligarchy.castChamberBallot(voterRow, "yes", afterSeason)).toMatchObject({ ok: false, code: 409 });

    // The public ledger names the voter and the side they took.
    const ledger = await m.oligarchy.chamberVotesView(voterRow, afterSeason);
    expect(ledger.open).toBeNull();
    expect(ledger.past[0]!.ballots).toEqual([
      expect.objectContaining({ voterName: "Krites", choice: "no" }),
    ]);
  });

  it("succession: the dynastic seat rides the slot row to the heir", async () => {
    const { children, players } = m.dbPkg;
    const holder = await createCharacter("Patroklos", { drachmae: 400 });
    expect((await m.oligarchy.buySeat(holder, now)).ok).toBe(true);

    // An of-age son (born 16 game years ago on the world clock).
    const gameYearMs = m.age.getAgeConfig().realMsPerGameYear;
    await db.insert(children).values({
      parentCharacterId: holder.id, worldId, name: "Telemachos", sex: "male",
      bornAt: new Date(now.getTime() - 16 * gameYearMs), named: true,
    });
    const { playerCharacters } = m.dbPkg;
    await db.update(playerCharacters).set({ status: "deceased" }).where(eq(playerCharacters.id, holder.id));

    const result = await m.succession.resolveSuccession(await freshRow(holder.id), undefined, now);
    expect(result).toMatchObject({ ok: true, kind: "blood", heirName: "Telemachos" });

    // The slot row is reused: the seat's character_id now resolves to the heir.
    const seat = await m.oligarchy.seatOf(holder.id);
    expect(seat?.holderType).toBe("player");
    const heir = await freshRow(holder.id);
    expect(heir.status).toBe("alive");
    expect(heir.isCouncilor).toBe(true); // alwaysInherited
    const heirName = (await db.select({ name: players.name }).from(players).where(eq(players.id, heir.playerId)))[0]!.name;
    expect(heirName).toBe("Telemachos");
  });

  it("regency: a regent holds the seat in trust and stays barred from elected office", async () => {
    const { children, playerCharacters } = m.dbPkg;
    const holder = await createCharacter("Kreon", { drachmae: 400 });
    expect((await m.oligarchy.buySeat(holder, now)).ok).toBe(true);

    // Only a 2-year-old ward -> a regency.
    const gameYearMs = m.age.getAgeConfig().realMsPerGameYear;
    await db.insert(children).values({
      parentCharacterId: holder.id, worldId, name: "Haimon", sex: "male",
      bornAt: new Date(now.getTime() - 2 * gameYearMs), named: true,
    });
    await db.update(playerCharacters).set({ status: "deceased" }).where(eq(playerCharacters.id, holder.id));

    const result = await m.succession.resolveSuccession(await freshRow(holder.id), undefined, now);
    expect(result).toMatchObject({ ok: true, kind: "regency" });

    const regent = await freshRow(holder.id);
    expect(regent.isRegent).toBe(true);
    expect(regent.isCouncilor).toBe(true); // the seat is held in trust...
    expect(await m.oligarchy.seatOf(holder.id)).not.toBeNull();
    // ...but the regent stays barred from elected office (the existing flag).
    expect(m.succession.regentMayHoldOffice(regent, "archon")).toBe(false);
    expect(m.succession.regentMayHoldOffice(regent, "ephor")).toBe(false);
  });
});
