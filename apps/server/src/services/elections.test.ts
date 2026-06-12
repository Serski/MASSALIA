import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Archon & Ephor election integration tests — run against a REAL Postgres,
// guarded to a *_test database (they truncate it). See oligarchy.test.ts for the
// setup recipe. Without DATABASE_URL pointing at *_test the suite is skipped.
// ---------------------------------------------------------------------------

const dbUrl = process.env.DATABASE_URL ?? "";
const runs = dbUrl.includes("_test");
const suite = describe.runIf(runs);

const SEASON = 86_400_000;
// A fixed world start so every phase boundary is deterministic. dueYear 6:
// declare season 25, vote 28, office 29.
const T0 = Date.UTC(2000, 0, 1);
const declareNow = new Date(T0 + 25 * SEASON + SEASON / 2); // season 25 — declaration
const voteNow = new Date(T0 + 28 * SEASON + SEASON / 2); // season 28 — voting
const resolveNow = new Date(T0 + 29 * SEASON + SEASON / 2); // season 29 — office (resolve)

async function loadModules() {
  const dbPkg = await import("@massalia/db");
  const elections = await import("./elections.js");
  const oligarchy = await import("./oligarchy.js");
  const festival = await import("./festival.js");
  const age = await import("./age.js");
  const family = await import("./family.js");
  const composure = await import("./composure.js");
  const routines = await import("./routines.js");
  return { dbPkg, elections, oligarchy, festival, age, family, composure, routines };
}
type Mods = Awaited<ReturnType<typeof loadModules>>;

suite("Archon & Ephor elections (integration)", () => {
  let m: Mods;
  let db: ReturnType<Mods["dbPkg"]["createDb"]>;
  let worldId: string;
  let seatCursor = 110;

  async function createCharacter(name: string, opts: { party?: string; prestige?: number; seat?: boolean } = {}) {
    const { users, players, playerCharacters } = m.dbPkg;
    const user = (await db.insert(users).values({ email: `${name}-${Math.random().toString(36).slice(2)}@t`, passwordHash: "x" }).returning())[0]!;
    const player = (await db.insert(players).values({ worldId, userId: user.id, name, color: "#123456", houseSlug: "test-house" }).returning())[0]!;
    const character = (
      await db
        .insert(playerCharacters)
        .values({ playerId: player.id, worldId, houseSlug: "test-house", classId: "trader", party: opts.party ?? "none", prestige: opts.prestige ?? 0, startAge: 30, deathAge: 90 })
        .returning()
    )[0]!;
    if (opts.seat !== false) {
      await db
        .update(m.dbPkg.oligarchSeats)
        .set({ holderType: "player", characterId: character.id, acquiredAt: declareNow })
        .where(and(eq(m.dbPkg.oligarchSeats.worldId, worldId), eq(m.dbPkg.oligarchSeats.seatIndex, seatCursor++)));
      await db.update(playerCharacters).set({ isCouncilor: true }).where(eq(playerCharacters.id, character.id));
    }
    return character;
  }
  const fresh = async (id: string) => (await db.select().from(m.dbPkg.playerCharacters).where(eq(m.dbPkg.playerCharacters.id, id)).limit(1))[0]!;

  beforeAll(async () => {
    m = await loadModules();
    db = m.dbPkg.createDb();
    await m.age.loadAgeConfig();
    await m.family.loadFamilyConfig();
    await m.composure.loadComposureConfig();
    await m.festival.loadCalendarConfig();
    await m.oligarchy.loadPoliticsConfig();
    await m.routines.loadRoutineContent();
  });

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE election_votes, election_candidates, elections, office_history, offices,
      chamber_ballots, chamber_votes, oligarch_seats, party_favor, daily_routines, effect_log, character_traits,
      player_characters, dynasties, players, sessions, users, worlds CASCADE`);
    await db.insert(m.dbPkg.houses).values({ slug: "test-house", name: "House Test", initial: "T", alignment: "c", stance: "s", motto: "m", patron: "p", crest: "c" }).onConflictDoNothing();
    const world = (await db.insert(m.dbPkg.worlds).values({ name: "Election Test", seed: "etest", startedAt: new Date(T0), endsAt: new Date(T0 + 182 * SEASON), status: "active" }).returning())[0]!;
    worldId = world.id;
    await m.dbPkg.ensureChamberSeats(worldId, m.oligarchy.getPoliticsConfig().chamber);
    seatCursor = 110;
  });

  // --- The full cycle, with cross-party kingmaking --------------------------
  it("runs declare → vote → resolve, writing the per-side plurality winner (incl. kingmaking)", async () => {
    // Two Palaioi candidates + one Dynatoi. Dynatoi voters will crown PB.
    const PA = await createCharacter("Pausanias", { party: "palaioi", prestige: 5 });
    const PB = await createCharacter("Polydoros", { party: "palaioi", prestige: 5 });
    const D1 = await createCharacter("Demosthenes", { party: "dynatoi", prestige: 5 });
    // Plain voters (no seat needed to vote).
    const palVoter = await createCharacter("PalVoter", { party: "palaioi", seat: false });
    const dynA = await createCharacter("DynA", { party: "dynatoi", seat: false });
    const dynB = await createCharacter("DynB", { party: "dynatoi", seat: false });
    const dynC = await createCharacter("DynC", { party: "dynatoi", seat: false });

    expect((await m.elections.declareCandidacy(await fresh(PA.id), "archon", undefined, declareNow)).ok).toBe(true);
    expect((await m.elections.declareCandidacy(await fresh(PB.id), "archon", undefined, declareNow)).ok).toBe(true);
    expect((await m.elections.declareCandidacy(await fresh(D1.id), "archon", undefined, declareNow)).ok).toBe(true);

    // Voting (Winter): Palaioi voter backs PA; three Dynatoi voters crown PB.
    expect((await m.elections.castVote(await fresh(palVoter.id), "archon", PA.id, voteNow)).ok).toBe(true);
    await m.elections.castVote(await fresh(dynA.id), "archon", PB.id, voteNow);
    await m.elections.castVote(await fresh(dynB.id), "archon", PB.id, voteNow);
    await m.elections.castVote(await fresh(dynC.id), "archon", D1.id, voteNow);

    // Resolve at the office season.
    const advanced = await m.dbPkg.advanceElections(m.festival.getCalendarConfig(), m.oligarchy.getPoliticsConfig(), resolveNow);
    const archon = advanced.resolved.find((r) => r.office === "archon")!;
    expect(archon.winners.palaioi).toBe(PB.id); // crowned by Dynatoi votes — kingmaking
    expect(archon.winners.dynatoi).toBe(D1.id);

    // offices written with acquired_via='elected' + the term years (office year 7, ends 13).
    const offices = await db.select().from(m.dbPkg.offices).where(and(eq(m.dbPkg.offices.worldId, worldId), eq(m.dbPkg.offices.office, "archon")));
    const palSeat = offices.find((o) => o.side === "palaioi")!;
    expect(palSeat.holderCharacterId).toBe(PB.id);
    expect(palSeat.acquiredVia).toBe("elected");
    expect(palSeat.termStartedYear).toBe(7);
    expect(palSeat.termEndsYear).toBe(13);
    // office_history records the elected term.
    const hist = await db.select().from(m.dbPkg.officeHistory).where(and(eq(m.dbPkg.officeHistory.characterId, PB.id), eq(m.dbPkg.officeHistory.office, "archon")));
    expect(hist).toHaveLength(1);
    expect(hist[0]!.acquiredVia).toBe("elected");
  });

  // --- The NPC base bloc backs its own side's frontrunner -------------------
  it("the NPC base bloc + favor-sway weigh on the tally", async () => {
    const P1 = await createCharacter("Solus", { party: "palaioi", prestige: 1 });
    // No Dynatoi candidate. With 50 NPC Palaioi (40 base) backing P1, P1 wins big.
    expect((await m.elections.declareCandidacy(await fresh(P1.id), "ephor", undefined, declareNow)).ok).toBe(true);
    const advanced = await m.dbPkg.advanceElections(m.festival.getCalendarConfig(), m.oligarchy.getPoliticsConfig(), resolveNow);
    const ephor = advanced.resolved.find((r) => r.office === "ephor")!;
    expect(ephor.winners.palaioi).toBe(P1.id);
    expect(ephor.winners.dynatoi).toBeNull(); // no candidate
    // P1's total includes the 40-strong Palaioi base bloc.
    expect(ephor.totals.find((t) => t.characterId === P1.id)!.total).toBeGreaterThanOrEqual(40);
  });

  // --- Sweep is idempotent + season-correct (NO boot backlog) ---------------
  it("opens declarations ONLY in the declaration window and never retro-fires", async () => {
    const cal = m.festival.getCalendarConfig();
    // Boot mid-VOTING with no prior declaration: nothing is opened, nothing resolves.
    expect(await m.dbPkg.openElectionsIfDue(cal, voteNow)).toHaveLength(0);
    expect((await m.dbPkg.advanceElections(cal, m.oligarchy.getPoliticsConfig(), voteNow)).resolved).toHaveLength(0);
    expect(await m.dbPkg.openElections()).toHaveLength(0); // no rows materialised

    // Boot AFTER the whole window: still nothing (no backlog dump).
    expect(await m.dbPkg.openElectionsIfDue(cal, resolveNow)).toHaveLength(0);
    expect(await m.dbPkg.openElections()).toHaveLength(0);

    // In the declaration window: opens exactly the two elected offices, once.
    const opened = await m.dbPkg.openElectionsIfDue(cal, declareNow);
    expect(opened.map((e) => e.office).sort()).toEqual(["archon", "ephor"]);
    expect(await m.dbPkg.openElectionsIfDue(cal, declareNow)).toHaveLength(0); // idempotent
  });

  it("resolving twice is a no-op (idempotent close)", async () => {
    const P1 = await createCharacter("Once", { party: "palaioi" });
    await m.elections.declareCandidacy(await fresh(P1.id), "archon", undefined, declareNow);
    const cal = m.festival.getCalendarConfig();
    const pol = m.oligarchy.getPoliticsConfig();
    // Both elected offices (archon + ephor) were opened this cycle, so both resolve.
    expect((await m.dbPkg.advanceElections(cal, pol, resolveNow)).resolved).toHaveLength(2);
    expect((await m.dbPkg.advanceElections(cal, pol, resolveNow)).resolved).toHaveLength(0);
  });

  // --- 2-term limit (elected only) ------------------------------------------
  it("enforces the 2-term limit on ELECTED terms, ignoring ascended/appointed", async () => {
    const C = await createCharacter("Kandidatos", { party: "palaioi" });
    // Two prior elected terms in archon → blocked from a third.
    await db.insert(m.dbPkg.officeHistory).values([
      { worldId, characterId: C.id, office: "archon", side: "palaioi", startedYear: 0, endedYear: 6, acquiredVia: "elected" },
      { worldId, characterId: C.id, office: "archon", side: "palaioi", startedYear: 6, endedYear: 12, acquiredVia: "elected" },
      { worldId, characterId: C.id, office: "archon", side: "palaioi", startedYear: 1, acquiredVia: "ascended" },
    ]);
    await m.dbPkg.openElectionsIfDue(m.festival.getCalendarConfig(), declareNow);
    expect(await m.dbPkg.electedTermCount(C.id, "archon")).toBe(2); // ascended not counted
    const res = await m.elections.declareCandidacy(await fresh(C.id), "archon", undefined, declareNow);
    expect(res).toMatchObject({ ok: false, code: 409 });
    // But the SAME character may still stand for a different office (ephor).
    expect((await m.elections.declareCandidacy(await fresh(C.id), "ephor", undefined, declareNow)).ok).toBe(true);
  });

  // --- Independents pick a side; party members are bound --------------------
  it("independents may declare on either side; party members only their own", async () => {
    const ind = await createCharacter("Adelos", { party: "none" });
    const pal = await createCharacter("Politis", { party: "palaioi" });
    await m.dbPkg.openElectionsIfDue(m.festival.getCalendarConfig(), declareNow);
    expect((await m.elections.declareCandidacy(await fresh(ind.id), "archon", "dynatoi", declareNow)).ok).toBe(true);
    expect((await m.elections.declareCandidacy(await fresh(pal.id), "archon", "dynatoi", declareNow))).toMatchObject({ ok: false });
    const seatless = await createCharacter("Aktemon", { party: "palaioi", seat: false });
    expect(await m.elections.declareCandidacy(await fresh(seatless.id), "archon", undefined, declareNow)).toMatchObject({ ok: false }); // no oligarch seat
  });

  // --- Death cascade ---------------------------------------------------------
  it("death cascade: Archon dies → same-side Ephor ascends → appoints a new Ephor", async () => {
    const archon = await seatHolderOffice("archon", "palaioi", "Archelaos", "palaioi");
    const ephor = await seatHolderOffice("ephor", "palaioi", "Ephialtes", "palaioi");
    const heir = await createCharacter("Hypatos", { party: "palaioi" });

    // The Archon dies.
    await db.update(m.dbPkg.playerCharacters).set({ status: "deceased" }).where(eq(m.dbPkg.playerCharacters.id, archon.id));
    expect(await m.elections.reconcileOffices(resolveNow)).toBe(true);

    // The Ephor ascended to Archon (acquired_via 'ascended'); Ephor seat vacant.
    const archonSeat = await officeSeat("archon", "palaioi");
    expect(archonSeat.holderCharacterId).toBe(ephor.id);
    expect(archonSeat.acquiredVia).toBe("ascended");
    expect((await officeSeat("ephor", "palaioi")).holderCharacterId).toBeNull();
    const ascHist = await db.select().from(m.dbPkg.officeHistory).where(and(eq(m.dbPkg.officeHistory.characterId, ephor.id), eq(m.dbPkg.officeHistory.office, "archon")));
    expect(ascHist[0]!.acquiredVia).toBe("ascended");

    // The new Archon appoints a replacement Ephor.
    const appoint = await m.elections.appointEphor(await fresh(ephor.id), "palaioi", heir.id, resolveNow);
    expect(appoint.ok).toBe(true);
    const ephorSeat = await officeSeat("ephor", "palaioi");
    expect(ephorSeat.holderCharacterId).toBe(heir.id);
    expect(ephorSeat.acquiredVia).toBe("appointed");
    const apptHist = await db.select().from(m.dbPkg.officeHistory).where(and(eq(m.dbPkg.officeHistory.characterId, heir.id), eq(m.dbPkg.officeHistory.acquiredVia, "appointed")));
    expect(apptHist).toHaveLength(1);
  });

  it("death cascade: Ephor dies → same-side Archon appoints a replacement", async () => {
    const archon = await seatHolderOffice("archon", "dynatoi", "Drakon", "dynatoi");
    const ephor = await seatHolderOffice("ephor", "dynatoi", "Eubolos", "dynatoi");
    const heir = await createCharacter("Nestor", { party: "dynatoi" });
    await db.update(m.dbPkg.playerCharacters).set({ status: "deceased" }).where(eq(m.dbPkg.playerCharacters.id, ephor.id));
    expect(await m.elections.reconcileOffices(resolveNow)).toBe(true);
    expect((await officeSeat("ephor", "dynatoi")).holderCharacterId).toBeNull();
    // Archon (untouched) appoints the replacement Ephor.
    expect((await m.elections.appointEphor(await fresh(archon.id), "dynatoi", heir.id, resolveNow)).ok).toBe(true);
    expect((await officeSeat("ephor", "dynatoi")).holderCharacterId).toBe(heir.id);
  });

  // --- Defection forfeit -----------------------------------------------------
  it("a party Archon who leaves the party forfeits the office → cascade", async () => {
    const archon = await seatHolderOffice("archon", "palaioi", "Apostates", "palaioi");
    const ephor = await seatHolderOffice("ephor", "palaioi", "Loyalos", "palaioi");
    // The Archon abandons the Palaioi (party → none).
    await db.update(m.dbPkg.playerCharacters).set({ party: "none" }).where(eq(m.dbPkg.playerCharacters.id, archon.id));
    expect(await m.elections.reconcileOffices(resolveNow)).toBe(true);
    // Forfeited → same-side Ephor ascends.
    expect((await officeSeat("archon", "palaioi")).holderCharacterId).toBe(ephor.id);
  });

  it("an INDEPENDENT office-holder keeps the seat as 'none' but forfeits on joining the opposing party", async () => {
    const ind = await seatHolderOffice("archon", "palaioi", "Eleutheros", "none", true);
    expect(await m.elections.reconcileOffices(resolveNow)).toBe(false); // 'none' is fine for an independent
    expect((await officeSeat("archon", "palaioi")).holderCharacterId).toBe(ind.id);
    await db.update(m.dbPkg.playerCharacters).set({ party: "dynatoi" }).where(eq(m.dbPkg.playerCharacters.id, ind.id));
    expect(await m.elections.reconcileOffices(resolveNow)).toBe(true); // joined the opposing party → forfeit
    expect((await officeSeat("archon", "palaioi")).holderCharacterId).toBeNull();
  });

  // --- Secret ballot ---------------------------------------------------------
  it("the ballot view never exposes another voter's choice", async () => {
    const cand = await createCharacter("Kryptos", { party: "palaioi" });
    const voter = await createCharacter("Mystery", { party: "dynatoi", seat: false });
    await m.elections.declareCandidacy(await fresh(cand.id), "archon", undefined, declareNow);
    await m.elections.castVote(await fresh(voter.id), "archon", cand.id, voteNow);
    // A DIFFERENT player's view shows candidates + their OWN (null) vote, never the voter's.
    const onlooker = await createCharacter("Onlooker", { party: "none", seat: false });
    const view = await m.elections.electionsView(await fresh(onlooker.id), voteNow);
    const archon = view.offices.find((o) => o.office === "archon")!;
    expect(archon.yourVote).toBeNull();
    expect(JSON.stringify(view)).not.toContain(voter.id);
  });

  // --- Strategoi appointment (cross-party balance) --------------------------
  it("the sitting officials appoint Strategoi with cross-party balance", async () => {
    const archon = await seatHolderOffice("archon", "palaioi", "Stratarchos", "palaioi");
    const palAppointee = await createCharacter("PalStrat", { party: "palaioi" });
    const palTwo = await createCharacter("PalTwo", { party: "palaioi" });
    const dynAppointee = await createCharacter("DynStrat", { party: "dynatoi" });
    const outsider = await createCharacter("Outsider", { party: "palaioi", seat: false });

    // A non-official cannot appoint.
    expect(await m.elections.appointStrategos(await fresh(outsider.id), palAppointee.id, resolveNow)).toMatchObject({ ok: false, code: 403 });
    // First Strategos: a Palaioi.
    expect((await m.elections.appointStrategos(await fresh(archon.id), palAppointee.id, resolveNow)).ok).toBe(true);
    // Second must NOT be the same party (cross-party balance).
    expect(await m.elections.appointStrategos(await fresh(archon.id), palTwo.id, resolveNow)).toMatchObject({ ok: false, code: 409 });
    // A Dynatoi balances it.
    expect((await m.elections.appointStrategos(await fresh(archon.id), dynAppointee.id, resolveNow)).ok).toBe(true);
    const strat = await db.select().from(m.dbPkg.offices).where(and(eq(m.dbPkg.offices.worldId, worldId), eq(m.dbPkg.offices.office, "strategos")));
    expect(strat.filter((s) => s.holderCharacterId).length).toBe(2);
  });

  // --- Campaign routine gating ----------------------------------------------
  it("the campaign routine is offered ONLY to a declared candidate, and grants party favor", async () => {
    const cand = await createCharacter("Kampaign", { party: "palaioi" });
    const bystander = await createCharacter("Idle", { party: "palaioi" });
    expect(await m.elections.eligibleForCampaign(cand.id)).toBe(false); // not yet declared
    await m.elections.declareCandidacy(await fresh(cand.id), "archon", undefined, declareNow);
    expect(await m.elections.eligibleForCampaign(cand.id)).toBe(true);
    expect(await m.elections.eligibleForCampaign(bystander.id)).toBe(false);

    await m.elections.grantCampaignFavor(cand.id);
    const favor = await db.select().from(m.dbPkg.partyFavor).where(and(eq(m.dbPkg.partyFavor.characterId, cand.id), eq(m.dbPkg.partyFavor.party, "palaioi")));
    expect(favor[0]!.favor).toBe(m.oligarchy.getPoliticsConfig().offices.campaign.favorGain);
  });

  // --- helpers ---------------------------------------------------------------
  async function seatHolderOffice(office: "archon" | "ephor", side: "palaioi" | "dynatoi", name: string, party: string, independent = false) {
    const character = await createCharacter(name, { party });
    await db.insert(m.dbPkg.offices).values({ worldId, office, side, seatSlot: 0, holderCharacterId: character.id, independentHolder: independent, acquiredVia: "elected", termStartedYear: 7, termEndsYear: 13 });
    await db.insert(m.dbPkg.officeHistory).values({ worldId, characterId: character.id, office, side, startedYear: 7, acquiredVia: "elected" });
    return character;
  }
  async function officeSeat(office: string, side: string) {
    return (await db.select().from(m.dbPkg.offices).where(and(eq(m.dbPkg.offices.worldId, worldId), eq(m.dbPkg.offices.office, office), eq(m.dbPkg.offices.side, side))).limit(1))[0]!;
  }
});
