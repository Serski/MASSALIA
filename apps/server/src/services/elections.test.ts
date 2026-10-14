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
  const traits = await import("./traits.js");
  const family = await import("./family.js");
  const composure = await import("./composure.js");
  const routines = await import("./routines.js");
  return { dbPkg, elections, oligarchy, festival, age, traits, family, composure, routines };
}
type Mods = Awaited<ReturnType<typeof loadModules>>;

suite("Archon & Ephor elections (integration)", () => {
  let m: Mods;
  let db: ReturnType<Mods["dbPkg"]["createDb"]>;
  let worldId: string;
  let seatCursor = 110;

  async function createCharacter(name: string, opts: { party?: string; prestige?: number; seat?: boolean; wasHoplite?: boolean; classId?: string; militia?: number; contractId?: string } = {}) {
    const { users, players, playerCharacters } = m.dbPkg;
    const user = (await db.insert(users).values({ email: `${name}-${Math.random().toString(36).slice(2)}@t`, passwordHash: "x" }).returning())[0]!;
    const player = (await db.insert(players).values({ worldId, userId: user.id, name, color: "#123456", houseSlug: "test-house" }).returning())[0]!;
    const character = (
      await db
        .insert(playerCharacters)
        .values({ playerId: player.id, worldId, houseSlug: "test-house", classId: opts.classId ?? "trader", party: opts.party ?? "none", prestige: opts.prestige ?? 0, militia: opts.militia ?? 0, contractId: opts.contractId ?? null, startAge: 30, deathAge: 90, wasHoplite: opts.wasHoplite ?? false })
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
    await m.traits.loadTraitDefs();
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

  // --- A party leader may stand (politics prompt 3b) ------------------------
  it("a seated Palaioi party_archon declares for Archon on the Palaioi bench: eligible before, a candidate after", async () => {
    const leader = await createCharacter("Hegemon", { party: "palaioi" });
    // The for-life party seat, as the world's first sync hands it out: interim, no end.
    await db.insert(m.dbPkg.offices).values({ worldId, office: "party_archon", side: "palaioi", seatSlot: 0, holderCharacterId: leader.id, independentHolder: false, acquiredVia: "interim", termStartedYear: 0, termEndsYear: null });
    await m.dbPkg.openElectionsIfDue(m.festival.getCalendarConfig(), declareNow);

    const before = (await m.elections.electionsView(await fresh(leader.id), declareNow)).offices.find((o) => o.office === "archon")!;
    expect(before.youMayDeclare).toEqual({ palaioi: true, dynatoi: false });
    expect(before.youAreCandidate).toBe(false);

    expect(await m.elections.declareCandidacy(await fresh(leader.id), "archon", "palaioi", declareNow)).toEqual({ ok: true, office: "archon", side: "palaioi" });

    const after = (await m.elections.electionsView(await fresh(leader.id), declareNow)).offices.find((o) => o.office === "archon")!;
    expect(after.youAreCandidate).toBe(true);
    // The party seat is untouched by the declaration.
    expect((await officeSeat("party_archon", "palaioi")).holderCharacterId).toBe(leader.id);
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

  // --- Strategoi appointment (cross-party balance) ---------------------------
  it("the sitting officials appoint Strategoi with cross-party balance", async () => {
    const archon = await seatHolderOffice("archon", "palaioi", "Stratarchos", "palaioi");
    const palAppointee = await createCharacter("PalStrat", { party: "palaioi", militia: 41 });
    const palTwo = await createCharacter("PalTwo", { party: "palaioi", militia: 60 });
    const dynAppointee = await createCharacter("DynStrat", { party: "dynatoi", militia: 41 });
    const outsider = await createCharacter("Outsider", { party: "palaioi", seat: false });

    // A non-official cannot appoint.
    expect(await m.elections.appointStrategos(await fresh(outsider.id), palAppointee.id, resolveNow)).toMatchObject({ ok: false, code: 403 });
    // First Strategos: a Palaioi.
    expect((await m.elections.appointStrategos(await fresh(archon.id), palAppointee.id, resolveNow)).ok).toBe(true);
    // Second must NOT be the same party (cross-party balance): refused, and not on the list.
    expect(await m.elections.appointStrategos(await fresh(archon.id), palTwo.id, resolveNow)).toEqual({ ok: false, code: 409, error: "The Strategoi must balance the parties — the other seat already holds this party." });
    expect((await m.elections.eligibleAppointees(null)).map((a) => a.characterId)).not.toContain(palTwo.id);
    // A Dynatoi balances it.
    expect((await m.elections.appointStrategos(await fresh(archon.id), dynAppointee.id, resolveNow)).ok).toBe(true);
    const strat = await db.select().from(m.dbPkg.offices).where(and(eq(m.dbPkg.offices.worldId, worldId), eq(m.dbPkg.offices.office, "strategos")));
    expect(strat.filter((s) => s.holderCharacterId).length).toBe(2);
  });

  // Strategoi prompt 1: any man with a sheet Militia above 40 may be Strategos,
  // and the picker lists exactly the men the appointment accepts.
  const listed = async (side: "palaioi" | "dynatoi" | null = null) => (await m.elections.eligibleAppointees(side)).map((a) => a.characterId);
  it("a shipbuilder of no party with a seat and a sheet Militia of 41 is listed and appointed; at 40 he is neither", async () => {
    const archon = await seatHolderOffice("archon", "palaioi", "Ajax", "palaioi");
    const wright = await createCharacter("Spartakolous", { classId: "shipbuilder", party: "none", militia: 41 });
    const short = await createCharacter("Shortwright", { classId: "shipbuilder", party: "none", militia: 40 });

    const list = await m.elections.eligibleAppointees(null);
    expect(list.find((a) => a.characterId === wright.id)).toEqual({ characterId: wright.id, name: "Spartakolous", houseName: "House Test", party: "none", militia: 41 });
    expect(list.map((a) => a.characterId)).not.toContain(short.id);

    expect(await m.elections.appointStrategos(await fresh(archon.id), short.id, resolveNow)).toEqual({ ok: false, code: 409, error: "A Strategos needs a Militia above 40." });
    expect(await m.elections.appointStrategos(await fresh(archon.id), wright.id, resolveNow)).toEqual({ ok: true, office: "strategos", side: null });
    const seat = (await db.select().from(m.dbPkg.offices).where(and(eq(m.dbPkg.offices.worldId, worldId), eq(m.dbPkg.offices.office, "strategos"))))[0]!;
    expect(seat).toMatchObject({ holderCharacterId: wright.id, acquiredVia: "appointed", independentHolder: true });
  });

  it("the sheet's Militia counts: a trait that lifts him above 40 lets him in; a former hoplite at 30 is refused", async () => {
    const archon = await seatHolderOffice("archon", "palaioi", "Ajax", "palaioi");
    // Base 39 and the Levy upbringing (+2 Militia): his sheet shows 41.
    const levy = await createCharacter("Levyman", { party: "none", militia: 39 });
    await db.insert(m.dbPkg.characterTraits).values({ characterId: levy.id, traitId: "gymnasium-1" });
    expect((await m.elections.eligibleAppointees(null)).find((a) => a.characterId === levy.id)).toMatchObject({ militia: 41 });
    expect((await m.elections.appointStrategos(await fresh(archon.id), levy.id, resolveNow)).ok).toBe(true);

    // A veteran of the phalanx is no longer enough: his Militia is what counts.
    const veteran = await createCharacter("OldSpear", { party: "dynatoi", wasHoplite: true, militia: 30 });
    expect(await listed()).not.toContain(veteran.id);
    expect(await m.elections.appointStrategos(await fresh(archon.id), veteran.id, resolveNow)).toEqual({ ok: false, code: 409, error: "A Strategos needs a Militia above 40." });
  });

  it("a sitting Archon, Ephor or Strategos is neither listed nor appointed, and neither is a man abroad on contract", async () => {
    const archon = await seatHolderOffice("archon", "palaioi", "Ajax", "palaioi");
    await db.update(m.dbPkg.playerCharacters).set({ militia: 90 }).where(eq(m.dbPkg.playerCharacters.id, archon.id));
    const ephor = await seatHolderOffice("ephor", "dynatoi", "Hector", "dynatoi");
    await db.update(m.dbPkg.playerCharacters).set({ militia: 70 }).where(eq(m.dbPkg.playerCharacters.id, ephor.id));
    const first = await createCharacter("Konrad", { party: "palaioi", militia: 94 });
    expect((await m.elections.appointStrategos(await fresh(archon.id), first.id, resolveNow)).ok).toBe(true);
    const abroad = await createCharacter("Sellsword", { party: "dynatoi", militia: 80, contractId: "syracuse" });

    const list = await listed();
    for (const c of [archon, ephor, first, abroad]) expect(list, c.id).not.toContain(c.id);
    const holds = { ok: false, code: 409, error: "He already holds one of the city's offices." };
    expect(await m.elections.appointStrategos(await fresh(archon.id), archon.id, resolveNow)).toEqual(holds);
    expect(await m.elections.appointStrategos(await fresh(archon.id), ephor.id, resolveNow)).toEqual(holds);
    expect(await m.elections.appointStrategos(await fresh(archon.id), first.id, resolveNow)).toEqual(holds);
    expect(await m.elections.appointStrategos(await fresh(archon.id), abroad.id, resolveNow)).toEqual({ ok: false, code: 409, error: "He is abroad on a mercenary contract." });
  });

  it("a party leader is listed and appointed, as Strategos and as an Ephor of his side", async () => {
    const archon = await seatHolderOffice("archon", "dynatoi", "Fortony", "dynatoi");
    const leader = await createCharacter("Seskios", { classId: "trader", party: "dynatoi", militia: 41 });
    await db.insert(m.dbPkg.offices).values({ worldId, office: "party_archon", side: "dynatoi", seatSlot: 0, holderCharacterId: leader.id, independentHolder: false, acquiredVia: "interim", termStartedYear: 0, termEndsYear: null });
    const second = await createCharacter("Akhaikos", { party: "dynatoi" });
    await db.insert(m.dbPkg.offices).values({ worldId, office: "party_ephor", side: "dynatoi", seatSlot: 0, holderCharacterId: second.id, independentHolder: false, acquiredVia: "interim", termStartedYear: 0, termEndsYear: null });

    // An Ephor of his side: the party's second leader is on the list and seated.
    expect(await listed("dynatoi")).toEqual(expect.arrayContaining([leader.id, second.id]));
    expect(await m.elections.appointEphor(await fresh(archon.id), "dynatoi", second.id, resolveNow)).toEqual({ ok: true, office: "ephor", side: "dynatoi" });
    // A Strategos: the party's first leader, Militia 41.
    expect(await listed()).toContain(leader.id);
    expect(await m.elections.appointStrategos(await fresh(archon.id), leader.id, resolveNow)).toEqual({ ok: true, office: "strategos", side: null });
    // Both keep their party seats.
    expect((await officeSeat("party_archon", "dynatoi")).holderCharacterId).toBe(leader.id);
    expect((await officeSeat("party_ephor", "dynatoi")).holderCharacterId).toBe(second.id);
    // Now they sit in League seats, they are off both lists.
    expect(await listed("dynatoi")).not.toContain(second.id);
    expect(await listed()).not.toContain(leader.id);
  });

  // --- The Strategoi are replaced with the elections (Strategoi prompt 1) ----
  // A Strategos serves to the end of the officials' term he was appointed in:
  // at season 53 (year 13, Spring) the officials of year 13 take office and both
  // seats fall vacant, whether or not the election seated anyone.
  const at = (season: number) => new Date(T0 + season * SEASON + SEASON / 2);
  const lastMomentOf = (season: number) => new Date(T0 + (season + 1) * SEASON - 1);
  const strategosSeat = async (holder: string) => (await db.select().from(m.dbPkg.offices).where(and(eq(m.dbPkg.offices.worldId, worldId), eq(m.dbPkg.offices.office, "strategos"), eq(m.dbPkg.offices.holderCharacterId, holder))))[0];
  const history = async (characterId: string) => (await db.select().from(m.dbPkg.officeHistory).where(and(eq(m.dbPkg.officeHistory.characterId, characterId), eq(m.dbPkg.officeHistory.office, "strategos"))));
  const sweep = (when: Date) => m.dbPkg.runElectionSweep(m.festival.getCalendarConfig(), m.oligarchy.getPoliticsConfig(), when);

  it("appointed in season 30 he serves to year 13: seated to the last moment of season 52, vacant after the first sync in season 53, his history ended with 13", async () => {
    const archon = await seatHolderOffice("archon", "palaioi", "Ajax", "palaioi");
    const strat = await createCharacter("Konrad", { party: "palaioi", militia: 84 });
    expect((await m.elections.appointStrategos(await fresh(archon.id), strat.id, at(30))).ok).toBe(true);
    expect(await strategosSeat(strat.id)).toMatchObject({ termStartedYear: 7, termEndsYear: 13 });

    await m.elections.syncElections(lastMomentOf(52));
    expect(await strategosSeat(strat.id)).toBeDefined();
    expect((await history(strat.id))[0]!.endedYear).toBeNull();

    await m.elections.syncElections(at(53));
    expect(await strategosSeat(strat.id)).toBeUndefined();
    const seats = await db.select().from(m.dbPkg.offices).where(and(eq(m.dbPkg.offices.worldId, worldId), eq(m.dbPkg.offices.office, "strategos")));
    expect(seats.map((s) => [s.holderCharacterId, s.termEndsYear, s.acquiredVia])).toEqual([[null, null, null]]);
    expect((await history(strat.id)).map((h) => [h.startedYear, h.endedYear])).toEqual([[7, 13]]);
    // Again: nothing more happens.
    await m.elections.syncElections(at(53));
    expect((await history(strat.id)).map((h) => h.endedYear)).toEqual([13]);
  });

  it("the worker's sweep alone ends the term in season 53, once", async () => {
    const archon = await seatHolderOffice("archon", "palaioi", "Ajax", "palaioi");
    const strat = await createCharacter("Konrad", { party: "palaioi", militia: 84 });
    expect((await m.elections.appointStrategos(await fresh(archon.id), strat.id, at(30))).ok).toBe(true);
    expect((await sweep(lastMomentOf(52))).strategoiEnded).toBe(0);
    expect(await strategosSeat(strat.id)).toBeDefined();
    expect((await sweep(at(53))).strategoiEnded).toBe(1);
    expect(await strategosSeat(strat.id)).toBeUndefined();
    expect((await history(strat.id)).map((h) => h.endedYear)).toEqual([13]);
    expect((await sweep(at(53))).strategoiEnded).toBe(0);
  });

  it("a Strategos with no term end, appointed before this rule, goes at the same change", async () => {
    const strat = await createCharacter("Konrad", { party: "palaioi", militia: 84 });
    await db.insert(m.dbPkg.offices).values({ worldId, office: "strategos", side: null, seatSlot: 0, holderCharacterId: strat.id, independentHolder: false, acquiredVia: "appointed", termStartedYear: 7, termEndsYear: null });
    await db.insert(m.dbPkg.officeHistory).values({ worldId, characterId: strat.id, office: "strategos", side: null, startedYear: 7, acquiredVia: "appointed" });
    await m.elections.syncElections(lastMomentOf(52));
    expect(await strategosSeat(strat.id)).toMatchObject({ termEndsYear: null });
    await m.elections.syncElections(at(53));
    expect(await strategosSeat(strat.id)).toBeUndefined();
    expect((await history(strat.id)).map((h) => h.endedYear)).toEqual([13]);
  });

  it("one appointed in season 52 by the outgoing officials goes at season 53; one appointed in season 53 stays to year 19", async () => {
    const archon = await seatHolderOffice("archon", "palaioi", "Ajax", "palaioi");
    const late = await createCharacter("Late", { party: "none", militia: 50 });
    expect((await m.elections.appointStrategos(await fresh(archon.id), late.id, at(52))).ok).toBe(true);
    expect(await strategosSeat(late.id)).toMatchObject({ termStartedYear: 13, termEndsYear: 13 });
    await m.elections.syncElections(at(53));
    expect(await strategosSeat(late.id)).toBeUndefined();
    expect((await history(late.id)).map((h) => h.endedYear)).toEqual([13]);

    const fresh53 = await createCharacter("Fresh", { party: "none", militia: 50 });
    expect((await m.elections.appointStrategos(await fresh(archon.id), fresh53.id, at(53))).ok).toBe(true);
    expect(await strategosSeat(fresh53.id)).toMatchObject({ termStartedYear: 13, termEndsYear: 19 });
    await m.elections.syncElections(at(53));
    await m.elections.syncElections(lastMomentOf(76));
    expect(await strategosSeat(fresh53.id)).toBeDefined();
    await m.elections.syncElections(at(77));
    expect(await strategosSeat(fresh53.id)).toBeUndefined();
    expect((await history(fresh53.id)).map((h) => h.endedYear)).toEqual([19]);
  });

  it("the death of one Strategos ends his own history row only", async () => {
    const archon = await seatHolderOffice("archon", "palaioi", "Ajax", "palaioi");
    const one = await createCharacter("One", { party: "palaioi", militia: 50 });
    const two = await createCharacter("Two", { party: "dynatoi", militia: 50 });
    expect((await m.elections.appointStrategos(await fresh(archon.id), one.id, at(30))).ok).toBe(true);
    expect((await m.elections.appointStrategos(await fresh(archon.id), two.id, at(30))).ok).toBe(true);
    await db.update(m.dbPkg.playerCharacters).set({ status: "deceased" }).where(eq(m.dbPkg.playerCharacters.id, one.id));
    expect(await m.elections.reconcileOffices(at(31))).toBe(true);
    expect(await strategosSeat(one.id)).toBeUndefined();
    expect((await history(one.id)).map((h) => h.endedYear)).toEqual([7]);
    expect(await strategosSeat(two.id)).toBeDefined();
    expect((await history(two.id)).map((h) => h.endedYear)).toEqual([null]);
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
