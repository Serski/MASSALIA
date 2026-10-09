import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";

// ---------------------------------------------------------------------------
// The Agenda & three governments (Politics Prompt 3) — integration tests against
// a REAL Postgres, guarded to a *_test database. Mirrors elections.test.ts.
// ---------------------------------------------------------------------------

const dbUrl = process.env.DATABASE_URL ?? "";
const suite = describe.runIf(dbUrl.includes("_test"));

const SEASON = 86_400_000;
const T0 = Date.UTC(2000, 0, 1);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const pools = {
  league: JSON.parse(readFileSync(resolve(root, "content/politics/agenda-league.json"), "utf8")),
  palaioi: JSON.parse(readFileSync(resolve(root, "content/politics/agenda-palaioi.json"), "utf8")),
  dynatoi: JSON.parse(readFileSync(resolve(root, "content/politics/agenda-dynatoi.json"), "utf8")),
};

async function loadModules() {
  const dbPkg = await import("@massalia/db");
  const oligarchy = await import("./oligarchy.js");
  const shared = await import("@massalia/shared");
  return { dbPkg, oligarchy, shared };
}
type Mods = Awaited<ReturnType<typeof loadModules>>;

suite("Agenda & three governments (integration)", () => {
  let m: Mods;
  let db: ReturnType<Mods["dbPkg"]["createDb"]>;
  let worldId: string;
  let cfg: import("@massalia/shared").PoliticsConfig;
  let calendar: import("@massalia/shared").CalendarConfig;
  let seatCursor = 110;
  const at = (season: number) => new Date(T0 + Math.round((season + 0.5) * SEASON));

  async function character(name: string, party: string, opts: { favor?: number; prestige?: number; militia?: number; seat?: boolean } = {}) {
    const { users, players, playerCharacters, oligarchSeats, partyFavor } = m.dbPkg;
    const user = (await db.insert(users).values({ email: `${name}-${Math.random().toString(36).slice(2)}@t`, passwordHash: "x" }).returning())[0]!;
    const player = (await db.insert(players).values({ worldId, userId: user.id, name, color: "#123456", houseSlug: "test-house" }).returning())[0]!;
    const c = (await db.insert(playerCharacters).values({ playerId: player.id, worldId, houseSlug: "test-house", classId: "trader", party, prestige: opts.prestige ?? 0, militia: opts.militia ?? 0, startAge: 30, deathAge: 90 }).returning())[0]!;
    if (opts.seat !== false) {
      await db.update(oligarchSeats).set({ holderType: "player", characterId: c.id, acquiredAt: at(8) }).where(and(eq(oligarchSeats.worldId, worldId), eq(oligarchSeats.seatIndex, seatCursor++)));
    }
    if (opts.favor) await db.insert(partyFavor).values({ characterId: c.id, party, favor: opts.favor }).onConflictDoNothing();
    return c.id;
  }
  const setOffice = (office: string, side: string | null, holder: string, term = 2) =>
    db.insert(m.dbPkg.offices).values({ worldId, office, side, seatSlot: 0, holderCharacterId: holder, termStartedYear: term, acquiredVia: "elected" }).onConflictDoUpdate({ target: [m.dbPkg.offices.worldId, m.dbPkg.offices.office, m.dbPkg.offices.side, m.dbPkg.offices.seatSlot], set: { holderCharacterId: holder, termStartedYear: term } });
  const ballot = (voteId: string, voter: string, choice: string) => db.insert(m.dbPkg.chamberBallots).values({ voteId, voterCharacterId: voter, choice }).onConflictDoNothing();

  beforeAll(async () => {
    m = await loadModules();
    db = m.dbPkg.createDb();
    await m.oligarchy.loadPoliticsConfig();
    cfg = m.oligarchy.getPoliticsConfig();
    calendar = m.shared.parseCalendarConfig(JSON.parse(readFileSync(resolve(root, "content/calendar/calendar-config.json"), "utf8")));
  });

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE league_projects, league_cities, party_endorsements, ephor_vetoes, agenda_cycles, treasury_ledger, treasuries,
      election_votes, election_candidates, elections, office_history, offices, chamber_ballots, chamber_votes,
      oligarch_seats, party_favor, effect_log, character_traits, player_characters, dynasties, players, sessions, users, worlds CASCADE`);
    await db.insert(m.dbPkg.houses).values({ slug: "test-house", name: "House Test", initial: "T", alignment: "c", stance: "s", motto: "m", patron: "p", crest: "c" }).onConflictDoNothing();
    const world = (await db.insert(m.dbPkg.worlds).values({ name: "Agenda Test", seed: "atest", startedAt: new Date(T0), endsAt: new Date(T0 + 182 * SEASON), status: "active" }).returning())[0]!;
    worldId = world.id;
    await m.dbPkg.ensureChamberSeats(worldId, cfg.chamber);
    await m.dbPkg.ensureTreasuries(worldId);
    // Palaioi-leaning cards pass deterministically with the opposing blocs removed.
    await db.delete(m.dbPkg.oligarchSeats).where(and(eq(m.dbPkg.oligarchSeats.worldId, worldId), eq(m.dbPkg.oligarchSeats.holderType, "npc"), sql`npc_party in ('dynatoi','independent')`));
    seatCursor = 110;
  });

  it("accrues the levy + party dues once per season, with the ledger, idempotently", async () => {
    await character("p1", "palaioi");
    await character("p2", "palaioi");
    await character("d1", "dynatoi");
    expect(await m.dbPkg.accrueTreasuries(cfg, at(8))).not.toBeNull();
    expect(await m.dbPkg.treasuryBalance(worldId, "league")).toBe(20);
    expect(await m.dbPkg.treasuryBalance(worldId, "palaioi")).toBe(10); // 2 × 5
    expect(await m.dbPkg.treasuryBalance(worldId, "dynatoi")).toBe(5);
    expect(await m.dbPkg.accrueTreasuries(cfg, at(8))).toBeNull(); // idempotent for the season
    expect((await m.dbPkg.treasuryLedgerRows(worldId, "league")).some((l) => l.reason.startsWith("levy:"))).toBe(true);
  });

  it("credits the league a cut of seat purchases and festival donations", async () => {
    await m.dbPkg.creditSeatPurchaseCut(worldId, 300, cfg, at(8));
    await m.dbPkg.creditFestivalDonationCut(worldId, 25, cfg, at(8));
    expect(await m.dbPkg.treasuryBalance(worldId, "league")).toBe(35); // 30 + 5
    const ledger = await m.dbPkg.treasuryLedgerRows(worldId, "league");
    expect(ledger.some((l) => l.reason === "cut:seat_purchase")).toBe(true);
    expect(ledger.some((l) => l.reason === "cut:festival_donation")).toBe(true);
  });

  // --- The League's building projects (government prompt 2a) -----------------
  // The League's docket is every project it can still build and afford; a passed
  // project is paid from the League treasury and stands `seasons` later.

  const leagueVote = async () => (await db.select().from(m.dbPkg.chamberVotes).where(and(eq(m.dbPkg.chamberVotes.worldId, worldId), eq(m.dbPkg.chamberVotes.scope, "league"))).limit(1))[0]!;
  const projects = () => db.select().from(m.dbPkg.leagueProjects).where(eq(m.dbPkg.leagueProjects.worldId, worldId));
  const agendaLedger = async () => (await m.dbPkg.treasuryLedgerRows(worldId, "league", 50)).filter((l) => l.reason.startsWith("agenda:"));
  const fortifications = async (cityId: string) => (await db.select({ f: m.dbPkg.leagueCities.fortifications }).from(m.dbPkg.leagueCities).where(and(eq(m.dbPkg.leagueCities.worldId, worldId), eq(m.dbPkg.leagueCities.cityId, cityId))))[0]!.f;

  it("runs a full league cycle: a docket of projects, draft → veto → re-draft → pass → pay and build", async () => {
    const archon = await character("archon", "palaioi");
    const ephor = await character("ephor", "palaioi", { militia: 5 });
    const voter = await character("voter", "palaioi");
    await setOffice("archon", "palaioi", archon);
    await setOffice("ephor", "palaioi", ephor);
    await m.dbPkg.creditTreasury(worldId, "league", 5000, "seed", at(8));
    const cyc = (await m.dbPkg.openAgendaCycleIfDue("league", cfg, pools, at(8)))!;
    expect(cyc.phase).toBe("drafting");
    // The docket is every project at the start populations within 5,000: all 36.
    expect(cyc.cardIds).toHaveLength(36);
    expect(cyc.cardIds.every((id) => id.startsWith("project:"))).toBe(true);
    expect(cyc.cardIds).toContain("project:massalia:temple");
    expect(cyc.cardIds).toContain("project:nikaia:walls");

    await m.dbPkg.setDraftedCard(cyc.id, "project:massalia:temple");
    expect(await m.dbPkg.setVeto(worldId, cyc.id, ephor, "league", 2)).toBe(true);
    expect(await m.dbPkg.setVeto(worldId, cyc.id, ephor, "league", 2)).toBe(false); // one per term
    await m.dbPkg.setDraftedCard(cyc.id, "project:nikaia:walls"); // 2,000, 8 seasons, leans palaioi

    await m.dbPkg.advanceAgendaCycles(calendar, cfg, pools, at(9)); // opens the chamber vote
    const vote = await leagueVote();
    expect(vote.agendaCardId).toBe("project:nikaia:walls");
    expect(vote.title).toBe("The Walls of Nikaia");
    expect(vote.leans).toEqual({ palaioi: "yes", dynatoi: "no", independent: "no" });
    await ballot(vote.id, voter, "yes");
    const balBefore = await m.dbPkg.treasuryBalance(worldId, "league");

    await m.dbPkg.closeDueChamberVotes(cfg, at(10));
    const adv = await m.dbPkg.advanceAgendaCycles(calendar, cfg, pools, at(10));
    expect((await db.select({ s: m.dbPkg.chamberVotes.status }).from(m.dbPkg.chamberVotes).where(eq(m.dbPkg.chamberVotes.id, vote.id)).limit(1))[0]!.s).toBe("passed");
    expect(adv.resolved).toEqual([{ scope: "league", gameYear: 2, cardId: "project:nikaia:walls", passed: true, applied: true, spent: 2000 }]);
    expect(balBefore - (await m.dbPkg.treasuryBalance(worldId, "league"))).toBe(2000);
    expect((await agendaLedger()).map((l) => [l.reason, l.delta])).toEqual([["agenda:project:nikaia:walls", -2000]]);

    const rows = await projects();
    expect(rows).toHaveLength(1);
    const cycle = (await m.dbPkg.getAgendaCycle(worldId, "league", 2))!;
    expect(cycle.phase).toBe("resolved");
    expect(rows[0]).toMatchObject({ cityId: "nikaia", buildingId: "walls", cost: 2000, agendaCycleId: cycle.id, completedAt: null });
    expect(rows[0]!.startedAt.getTime()).toBe(cycle.votingEndsAt.getTime());
    expect(rows[0]!.startedAt.getTime()).toBe(T0 + 10 * SEASON);
    expect(rows[0]!.completesAt.getTime()).toBe(T0 + 18 * SEASON);

    // A second advance writes nothing more.
    const again = await m.dbPkg.advanceAgendaCycles(calendar, cfg, pools, at(10));
    expect(again.resolved).toEqual([]);
    expect(await projects()).toHaveLength(1);
    expect(await agendaLedger()).toHaveLength(1);
    expect(balBefore - (await m.dbPkg.treasuryBalance(worldId, "league"))).toBe(2000);
  });

  it("never overspends — a passed project the treasury can no longer cover writes no project, no debit and no ledger row", async () => {
    const voter = await character("voter", "palaioi");
    await m.dbPkg.creditTreasury(worldId, "league", 2500, "seed", at(8));
    const cyc = (await m.dbPkg.openAgendaCycleIfDue("league", cfg, pools, at(8)))!;
    expect(cyc.cardIds).toContain("project:nikaia:walls");
    await m.dbPkg.setDraftedCard(cyc.id, "project:nikaia:walls"); // 2,000
    await m.dbPkg.advanceAgendaCycles(calendar, cfg, pools, at(9));
    const vote = await leagueVote();
    await ballot(vote.id, voter, "yes");
    await m.dbPkg.creditTreasury(worldId, "league", -1500, "seed", at(9)); // only 1,000 left
    const balBefore = await m.dbPkg.treasuryBalance(worldId, "league");
    await m.dbPkg.closeDueChamberVotes(cfg, at(10));
    const adv = await m.dbPkg.advanceAgendaCycles(calendar, cfg, pools, at(10));
    expect(adv.resolved).toEqual([{ scope: "league", gameYear: 2, cardId: "project:nikaia:walls", passed: true, applied: false, spent: 0 }]);
    expect(await m.dbPkg.treasuryBalance(worldId, "league")).toBe(balBefore);
    expect(await projects()).toEqual([]);
    expect(await agendaLedger()).toEqual([]);
    expect((await m.dbPkg.getAgendaCycle(worldId, "league", 2))!.phase).toBe("resolved");
  });

  it("an open vote: advancing a League cycle whose vote is still open leaves it in voting and writes nothing", async () => {
    const voter = await character("voter", "palaioi");
    await m.dbPkg.creditTreasury(worldId, "league", 5000, "seed", at(8));
    const cyc = (await m.dbPkg.openAgendaCycleIfDue("league", cfg, pools, at(8)))!;
    await m.dbPkg.setDraftedCard(cyc.id, "project:nikaia:walls");
    await m.dbPkg.advanceAgendaCycles(calendar, cfg, pools, at(9));
    const vote = await leagueVote();
    await ballot(vote.id, voter, "yes");

    // Resolve time has come, but the vote has not been closed yet.
    const adv = await m.dbPkg.advanceAgendaCycles(calendar, cfg, pools, at(10));
    expect(adv.resolved).toEqual([]);
    expect((await m.dbPkg.getAgendaCycle(worldId, "league", 2))!.phase).toBe("voting");
    expect(await projects()).toEqual([]);
    expect(await m.dbPkg.treasuryBalance(worldId, "league")).toBe(5000);

    // Once the vote closes, the next pass resolves it.
    await m.dbPkg.closeDueChamberVotes(cfg, at(10));
    const after = await m.dbPkg.advanceAgendaCycles(calendar, cfg, pools, at(10));
    expect(after.resolved).toHaveLength(1);
    expect(after.resolved[0]!.applied).toBe(true);
    expect(await projects()).toHaveLength(1);
    expect(await m.dbPkg.treasuryBalance(worldId, "league")).toBe(3000);
  });

  it("completion: the Walls stand once, raise the polis's fortifications by 1, and never past 5", async () => {
    await m.dbPkg.ensureLeagueCities(db, worldId);
    const completesAt = at(18);
    await db.insert(m.dbPkg.leagueProjects).values({ worldId, cityId: "nikaia", buildingId: "walls", cost: 2000, startedAt: at(10), completesAt });
    const before = await fortifications("nikaia");

    expect(await m.dbPkg.completeLeagueProjects(new Date(completesAt.getTime() - 1))).toEqual([]);
    expect(await fortifications("nikaia")).toBe(before);

    const done = await m.dbPkg.completeLeagueProjects(completesAt);
    expect(done.map((p) => [p.cityId, p.buildingId])).toEqual([["nikaia", "walls"]]);
    expect(await fortifications("nikaia")).toBe(before + 1);
    const row = (await projects())[0]!;
    expect(row.completedAt?.getTime()).toBe(completesAt.getTime());

    expect(await m.dbPkg.completeLeagueProjects(new Date(completesAt.getTime() + SEASON))).toEqual([]);
    expect(await fortifications("nikaia")).toBe(before + 1);

    // Walls on a polis already at 5 leave it at 5; a Port raises nothing.
    await db.update(m.dbPkg.leagueCities).set({ fortifications: 5 }).where(and(eq(m.dbPkg.leagueCities.worldId, worldId), eq(m.dbPkg.leagueCities.cityId, "massalia")));
    await db.insert(m.dbPkg.leagueProjects).values({ worldId, cityId: "massalia", buildingId: "walls", cost: 2000, startedAt: at(10), completesAt });
    await db.insert(m.dbPkg.leagueProjects).values({ worldId, cityId: "olbia", buildingId: "port", cost: 2000, startedAt: at(10), completesAt });
    const olbiaBefore = await fortifications("olbia");
    expect((await m.dbPkg.completeLeagueProjects(completesAt)).map((p) => p.cityId).sort()).toEqual(["massalia", "olbia"]);
    expect(await fortifications("massalia")).toBe(5);
    expect(await fortifications("olbia")).toBe(olbiaBefore);
  });

  it("a party vote counts only that party's members + that party's NPC bloc", async () => {
    const partyArchon = await character("pa", "palaioi");
    await setOffice("party_archon", "palaioi", partyArchon);
    const palVoter = await character("palV", "palaioi");
    const dynVoter = await character("dynV", "dynatoi");
    await m.dbPkg.creditTreasury(worldId, "palaioi", 100, "seed", at(10));
    const cyc = (await m.dbPkg.openAgendaCycleIfDue("palaioi", cfg, pools, at(10)))!; // offset season
    await m.dbPkg.setDraftedCard(cyc.id, "pal-founders-feast");
    await m.dbPkg.advanceAgendaCycles(calendar, cfg, pools, at(11));
    const vote = (await db.select().from(m.dbPkg.chamberVotes).where(and(eq(m.dbPkg.chamberVotes.worldId, worldId), eq(m.dbPkg.chamberVotes.scope, "palaioi"))).limit(1))[0]!;
    expect(vote.scope).toBe("palaioi");
    await ballot(vote.id, palVoter, "yes");
    await ballot(vote.id, dynVoter, "no"); // a dynatoi member — must be excluded
    await m.dbPkg.closeDueChamberVotes(cfg, at(12));
    expect((await db.select({ no: m.dbPkg.chamberVotes.noCount }).from(m.dbPkg.chamberVotes).where(eq(m.dbPkg.chamberVotes.id, vote.id)).limit(1))[0]!.no).toBe(0); // dynatoi ballot excluded
  });

  it("the internal favor-weighted ballot fills a vacant party leadership on death", async () => {
    const high = await character("high", "palaioi", { favor: 60 });
    await character("low", "palaioi", { favor: 5 });
    const dying = await character("dying", "palaioi", { favor: 1 });
    await setOffice("party_archon", "palaioi", dying);
    await db.update(m.dbPkg.playerCharacters).set({ status: "deceased" }).where(eq(m.dbPkg.playerCharacters.id, dying));
    await m.dbPkg.ensurePartyLeaders(at(13));
    const holder = (await db.select({ h: m.dbPkg.offices.holderCharacterId }).from(m.dbPkg.offices).where(and(eq(m.dbPkg.offices.worldId, worldId), eq(m.dbPkg.offices.office, "party_archon"), eq(m.dbPkg.offices.side, "palaioi"))).limit(1))[0]!;
    expect(holder.h).toBe(high); // the highest-favor living member wins
  });

  it("endorsement adds the configured swing to the endorsee", async () => {
    const leader = await character("leader", "palaioi");
    const cand = await character("cand", "palaioi");
    await setOffice("party_ephor", "palaioi", leader);
    const election = (await db.insert(m.dbPkg.elections).values({ worldId, office: "archon", gameYear: 50, phase: "declaration", declarationEndsAt: at(60), votingEndsAt: at(61) }).returning())[0]!;
    await m.dbPkg.recordEndorsement(worldId, election.id, leader, "palaioi", cand);
    const sway = await m.dbPkg.endorsementSwayByCandidate(election.id, cfg);
    expect(sway[cand]).toBe(cfg.endorsement.swingVotes);
  });
});
