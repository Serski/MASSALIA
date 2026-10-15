import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import { buildingEffects, festivalEffects, leagueDocket, parseCitiesContent, parseLeagueBuildings, parseLeagueFestivals } from "@massalia/shared";

// ---------------------------------------------------------------------------
// GET /api/government and the public League scope of GET /api/agenda
// (government prompt 1). The sitting Archons, Ephors and Strategoi get the
// Government view: their seats, the League treasury's books and the docket.
// Everyone else gets `{ member: false }`, and the public agenda gives them the
// League treasury's balance alone, never the ledger, the draft or the veto, and
// of the docket only the card going to the vote. Integration test against a
// REAL Postgres, guarded to a *_test database; a minimal Fastify app with a
// minted session cookie, as the other route tests build one. The routes run on
// the real clock, so a world "in its first Winter" started an hour ago.
// ---------------------------------------------------------------------------

const dbUrl = process.env.DATABASE_URL ?? "";
const suite = describe.runIf(dbUrl.includes("_test"));

const DAY = 86_400_000;
const HOUR = 3_600_000;
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const content = (file: string) => JSON.parse(readFileSync(resolve(root, "content", file), "utf8"));
const buildings = parseLeagueBuildings(content("politics/league-buildings.json")).buildings;
const cities = parseCitiesContent(content("cities/cities.json")).cities;
const festivals = parseLeagueFestivals(content("politics/league-festivals.json")).festivals;
// The League's docket at the start populations with the treasury full (government prompt 2a).
const startDocket = leagueDocket(buildings, cities.map((c) => ({ id: c.id, name: c.name, population: c.start.population })), new Set(), Number.MAX_SAFE_INTEGER);

function hashToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

async function loadModules() {
  const dbPkg = await import("@massalia/db");
  const { agendaRoutes } = await import("./agenda.js");
  const { governmentRoutes } = await import("./government.js");
  const agenda = await import("../services/agenda.js");
  const { loadPoliticsConfig, getPoliticsConfig } = await import("../services/oligarchy.js");
  const { loadCalendarConfig } = await import("../services/festival.js");
  const { loadBuildingsContent } = await import("../services/buildings.js");
  const { loadBarracksContent } = await import("../services/barracks.js");
  return { dbPkg, agendaRoutes, governmentRoutes, agenda, loadPoliticsConfig, getPoliticsConfig, loadCalendarConfig, loadBuildingsContent, loadBarracksContent };
}
type Mods = Awaited<ReturnType<typeof loadModules>>;

type Units = { hoplite: number; peltast: number; ekdromos: number; hippeis: number };
type Scope = { phase: string | null; nextOpensLabel: string | null; cards: { id: string; title: string; group?: string; seasons?: number; effects?: string[] }[]; draftedCardId: string | null; vetoedCardId: string | null; treasury: { balance: number; ledger: unknown[] }; youMayDraft: boolean; youMayVeto: boolean };
type Gov =
  | { member: false }
  | {
      member: true;
      seats: { office: string; side: string | null }[];
      treasury: { balance: number; taxPerSeason: number; ledger: { delta: number; label: string; dateLabel: string; createdAt: string }[] };
      projects: { cityId: string; polis: string; buildingId: string; title: string; status: string; completesAt: string; completesLabel: string }[];
      league: Scope;
      festival: Scope;
      war: Scope;
      army: {
        towns: { townId: string; name: string; units: { hoplite: number; peltast: number; ekdromos: number; hippeis: number }; men: number }[];
        holdings: { id: string; name: string; units: Units; men: number; minGarrison: number }[];
        parties: { kind: string; returning: boolean; from: string; to: string; units: Units; men: number; arrivesAt: string }[];
        fleet: { at: string; pentekonters: number; triremes: number; atSea: { pentekonters: number; triremes: number; to: string; returnsAt: string }[] };
        men: number;
        upkeepPerSeason: number;
        lastDesertion: { men: number; label: string } | null;
        orders: { id: string; kind: string; by: string; office: string; side: string | null; from: string; to: string; units: Units; men: number; suppliesCost: number; dateLabel: string; orderedAt: string }[];
        reports: { id: string; kind: string; to: string; line: string; dateLabel: string; arrivedAt: string }[];
        sightings: { id: string; name: string; town: boolean; men: number; pentekonters: number; triremes: number; asOf: string }[];
      };
    };

suite("GET /api/government and the public League scope (integration)", () => {
  let m: Mods;
  let db: ReturnType<Mods["dbPkg"]["createDb"]>;
  let app: FastifyInstance;
  let worldId: string;
  let houseSlug: string;

  beforeAll(async () => {
    m = await loadModules();
    db = m.dbPkg.createDb();
    await m.loadPoliticsConfig();
    await m.loadCalendarConfig();
    await m.agenda.loadAgendaContent();
    // A League holding's minimum garrison is battle.json's, which loads after the goods.
    await m.loadBuildingsContent();
    await m.loadBarracksContent();
    app = Fastify();
    await app.register(cookie, { secret: "test-session-secret-at-least-32-chars-long" });
    await app.register(m.agendaRoutes, { prefix: "/api/agenda" });
    await app.register(m.governmentRoutes, { prefix: "/api/government" });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE league_wars, faction_relations, league_projects, party_endorsements, ephor_vetoes, agenda_cycles, treasury_ledger, treasuries, league_cities, world_treasury,
      election_votes, election_candidates, elections, office_history, offices, chamber_ballots, chamber_votes,
      oligarch_seats, party_favor, effect_log, character_traits, player_characters, dynasties, players, sessions, users, worlds CASCADE`);
    await db.insert(m.dbPkg.houses).values({ slug: "test-house", name: "House Test", initial: "T", alignment: "c", stance: "s", motto: "m", patron: "p", crest: "c" }).onConflictDoNothing();
    houseSlug = (await db.select({ slug: m.dbPkg.houses.slug }).from(m.dbPkg.houses).where(eq(m.dbPkg.houses.slug, "test-house")).limit(1))[0]!.slug;
  });

  // A world whose first Winter holds `now`: drafting for the League's year 0.
  async function world(startedAt: Date): Promise<string> {
    worldId = (await db.insert(m.dbPkg.worlds).values({ name: "Government Test", seed: "gtest", startedAt, endsAt: new Date(startedAt.getTime() + 182 * DAY), status: "active" }).returning())[0]!.id;
    return worldId;
  }
  const firstWinter = () => world(new Date(Date.now() - HOUR));

  async function citizen(name: string, party = "palaioi") {
    const { users, players, playerCharacters, sessions } = m.dbPkg;
    const user = (await db.insert(users).values({ email: `${name}-${Math.random().toString(36).slice(2)}@t`, passwordHash: "x" }).returning())[0]!;
    const player = (await db.insert(players).values({ worldId, userId: user.id, name: `${name}-${Math.random().toString(36).slice(2, 6)}`, color: "#123456", houseSlug }).returning())[0]!;
    const character = (await db.insert(playerCharacters).values({ playerId: player.id, worldId, houseSlug, classId: "trader", party, startAge: 30, deathAge: 90 }).returning())[0]!;
    const token = crypto.randomBytes(16).toString("base64url");
    await db.insert(sessions).values({ userId: user.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + DAY) });
    return { token, characterId: character.id, row: character };
  }
  const seat = (office: string, side: string | null, holder: string) =>
    db.insert(m.dbPkg.offices).values({ worldId, office, side, seatSlot: 0, holderCharacterId: holder, termStartedYear: 0, acquiredVia: "elected" });

  const get = (url: string, token?: string) => app.inject({ method: "GET", url, headers: token ? { cookie: `massalia_session=${app.signCookie(token)}` } : {} });
  const government = async (token: string) => (await get("/api/government", token)).json() as Gov;
  const leagueScope = async (token: string) => ((await get("/api/agenda", token)).json() as { league: Scope }).league;
  const festivalScope = async (token: string) => ((await get("/api/agenda", token)).json() as { festival: Scope }).festival;
  const draft = (token: string, cardId: string) => app.inject({ method: "POST", url: "/api/agenda/draft", headers: { cookie: `massalia_session=${app.signCookie(token)}` }, payload: { scope: "league", cardId } });

  it("answers 401 without a session", async () => {
    await firstWinter();
    expect((await get("/api/government")).statusCode).toBe(401);
  });

  it("a citizen with no office is not a member, and the public League scope shows the balance alone", async () => {
    await firstWinter();
    const c = await citizen("citizen");
    expect(await government(c.token)).toEqual({ member: false });

    const scope = await leagueScope(c.token);
    expect(scope.phase).toBe("drafting");
    expect(scope.cards).toEqual([]);
    expect(scope.draftedCardId).toBeNull();
    expect(scope.vetoedCardId).toBeNull();
    expect(scope.treasury.ledger).toEqual([]);
    expect(scope.youMayDraft).toBe(false);
    expect(scope.youMayVeto).toBe(false);
    // The sync credited the opening balance, the first Winter's tax and the levy,
    // then raised the League's army and paid its season: 513 for 2,050 men.
    expect(scope.treasury.balance).toBe(60_000 + 910 + m.getPoliticsConfig().treasury.leviedPerSeason - 513);
  });

  it("an Archon is a member with the docket, the draft power, the tax and the labelled ledger; their draft stays off the public scope", async () => {
    await firstWinter();
    const archon = await citizen("archon");
    await seat("archon", "palaioi", archon.characterId);
    const c = await citizen("citizen");

    const view = await government(archon.token);
    expect(view.member).toBe(true);
    if (!view.member) return;
    expect(view.seats).toEqual([{ office: "archon", side: "palaioi" }]);
    expect(view.league.phase).toBe("drafting");
    // The docket is every building project at the start populations (36), each with its polis and build time.
    expect(startDocket).toHaveLength(36);
    expect(view.league.cards.map((c) => c.id)).toEqual(startDocket.map((p) => p.id));
    for (const card of view.league.cards) {
      const project = startDocket.find((p) => p.id === card.id)!;
      expect(card.group).toBe(project.polis);
      expect(card.seasons).toBe(project.seasons);
      expect(card.title).toBe(project.title);
      // What the project does when it stands (government prompt 2b).
      expect(card.effects).toEqual(buildingEffects(buildings.find((b) => b.id === project.buildingId)!, project.polis));
    }
    expect(view.league.cards[0]!.effects).toEqual(["Priests +20 dr a season for 4 seasons", "Every army +3 morale for 2 years", "Massalia +3 stability a year"]);
    expect(view.league.youMayDraft).toBe(true);
    expect(view.league.youMayVeto).toBe(false);
    expect(view.treasury.balance).toBe(60_000 + 910 + m.getPoliticsConfig().treasury.leviedPerSeason - 513);
    expect(view.treasury.taxPerSeason).toBe(910);
    const lines = view.treasury.ledger.map((l) => [l.delta, l.label, l.dateLabel]);
    // The army's first season is paid in the same sync (government prompt 5a).
    expect(lines).toContainEqual([-513, "Army upkeep", "Winter, 300 BC"]);
    expect(lines).toContainEqual([60_000, "Opening balance", "Winter, 300 BC"]);
    expect(lines).toContainEqual([910, "Taxes of the poleis", "Winter, 300 BC"]);
    expect(lines).toContainEqual([m.getPoliticsConfig().treasury.leviedPerSeason, "Levy", "Winter, 300 BC"]);
    for (const l of view.treasury.ledger) expect(Date.parse(l.createdAt)).not.toBeNaN();

    const cardId = view.league.cards[0]!.id;
    expect((await draft(archon.token, cardId)).statusCode).toBe(200);
    const after = await government(archon.token);
    expect(after.member && after.league.draftedCardId).toBe(cardId);
    const scope = await leagueScope(c.token);
    expect(scope.cards).toEqual([]);
    expect(scope.draftedCardId).toBeNull();
    expect(scope.treasury.ledger).toEqual([]);
  });

  // Strikes prompt 1: the strikes on the Government tab, the League's strike
  // reports where its march reports go, and the raid's ledger row in words.
  it("a member sees the strikes, the League's strike report among the army's reports, and the raid's ledger row as 'Raid by the Volcae on Agathe'", async () => {
    await firstWinter();
    const archon = await citizen("archon");
    await seat("archon", "palaioi", archon.characterId);
    await government(archon.token); // the sync's opening rows first
    const struckAt = new Date(Date.now() - 10 * 60_000);
    const line = "The Volcae broke into Agathe. They carried off 900 drachmae from the treasury, and 80 of its people were lost.";
    const struck = (await db.insert(m.dbPkg.strikes).values({ worldId, nationId: "volcae", trigger: "war", mode: "raid", seasonIndex: 0, regionId: "R050", townId: "agathe", targetKind: "home", force: 500, about: 500, draws: [], calledAt: new Date(struckAt.getTime() - 12 * HOUR), strikesAt: struckAt, status: "struck", resolvedAt: struckAt, report: { line } }).returning())[0]!;
    await db.insert(m.dbPkg.strikes).values({ worldId, nationId: "saluvii", trigger: "raids", mode: "raid", seasonIndex: 0, triggerPlaceId: "reii", triggerAt: new Date(), regionId: "R060", townId: "massalia", targetKind: "home", force: 160, about: 160, draws: [], calledAt: new Date(), strikesAt: new Date(Date.now() + 12 * HOUR) });
    await db.insert(m.dbPkg.treasuryLedger).values({ worldId, owner: "league", delta: -900, reason: `strike:volcae:agathe:${struck.id}`, createdAt: struckAt });
    const view = (await government(archon.token)) as unknown as { member: true; strikes: { nation: string; place: string; status: string; line: string; about: number }[]; army: { reports: { kind: string; to: string; line: string }[] }; treasury: { ledger: { label: string; delta: number }[] } };
    expect(view.strikes.map((x) => [x.nation, x.place, x.status, x.about])).toEqual([["the Saluvii", "Massalia", "marching", 160], ["the Volcae", "Agathe", "struck", 500]]);
    expect(view.strikes[0]!.line).toMatch(/^Raided once too often, the Saluvii march on Massalia with about 160 men\. They strike at \d\d:\d\d UTC\.$/);
    expect(view.strikes[1]!.line).toBe(line);
    expect(view.army.reports).toContainEqual(expect.objectContaining({ kind: "strike", to: "Agathe", line }));
    expect(view.treasury.ledger).toContainEqual(expect.objectContaining({ label: "Raid by the Volcae on Agathe", delta: -900 }));
    expect(JSON.stringify(view.strikes)).not.toContain("draws");
  });

  it("an Ephor may veto once a card is drafted, a Strategos has neither power, a party Archon is no member", async () => {
    await firstWinter();
    const archon = await citizen("archon");
    const ephor = await citizen("ephor", "dynatoi");
    const strategos = await citizen("strategos");
    const partyArchon = await citizen("party-archon");
    await seat("archon", "palaioi", archon.characterId);
    await seat("ephor", "dynatoi", ephor.characterId);
    await seat("strategos", null, strategos.characterId);
    await seat("party_archon", "palaioi", partyArchon.characterId);

    const ephorBefore = await government(ephor.token);
    expect(ephorBefore.member && ephorBefore.seats).toEqual([{ office: "ephor", side: "dynatoi" }]);
    expect(ephorBefore.member && ephorBefore.league.youMayVeto).toBe(false);

    const docket = await government(archon.token);
    await draft(archon.token, (docket.member && docket.league.cards[0]!.id) as string);

    const ephorAfter = await government(ephor.token);
    expect(ephorAfter.member && ephorAfter.league.youMayVeto).toBe(true);
    expect(ephorAfter.member && ephorAfter.league.youMayDraft).toBe(false);

    const s = await government(strategos.token);
    expect(s.member && s.seats).toEqual([{ office: "strategos", side: null }]);
    expect(s.member && s.league.youMayDraft).toBe(false);
    expect(s.member && s.league.youMayVeto).toBe(false);
    expect(s.member && s.league.cards.length).toBeGreaterThan(0);

    expect(await government(partyArchon.token)).toEqual({ member: false });
  });

  it("a member sees the League's projects, under way first, and a spend ledger row names the project", async () => {
    await firstWinter();
    const strategos = await citizen("strategos");
    await seat("strategos", null, strategos.characterId);
    const startedMs = Date.now() - HOUR;
    // The Walls of Nikaia under way (stand in the Winter eight seasons on, an hour
    // past the boundary so the game date is unambiguous), the Port of Olbia standing.
    await db.insert(m.dbPkg.leagueProjects).values({ worldId, cityId: "nikaia", buildingId: "walls", cost: 2000, startedAt: new Date(startedMs), completesAt: new Date(startedMs + 8 * DAY + HOUR) });
    await db.insert(m.dbPkg.leagueProjects).values({ worldId, cityId: "olbia", buildingId: "port", cost: 2000, startedAt: new Date(startedMs - 9 * DAY), completesAt: new Date(startedMs - DAY), completedAt: new Date(startedMs - DAY) });
    await db.insert(m.dbPkg.treasuryLedger).values({ worldId, owner: "league", delta: -2000, reason: "agenda:project:nikaia:walls" });
    await db.insert(m.dbPkg.treasuryLedger).values({ worldId, owner: "league", delta: -500, reason: "agenda:festival:dionysia:y1" });
    await db.insert(m.dbPkg.treasuryLedger).values({ worldId, owner: "league", delta: -2000, reason: "agenda:war:carthage:y1" });
    await db.insert(m.dbPkg.treasuryLedger).values({ worldId, owner: "league", delta: -2001, reason: "agenda:war:cadurci:y2" });

    const view = await government(strategos.token);
    expect(view.member).toBe(true);
    if (!view.member) return;
    expect(view.projects.map((p) => [p.title, p.polis, p.status, p.completesLabel])).toEqual([
      ["The Walls of Nikaia", "Nikaia", "building", "Winter, 298 BC"],
      ["The Port of Olbia", "Olbia", "built", "Winter, 300 BC"],
    ]);
    expect(view.projects[0]!.completesAt).toBe(new Date(startedMs + 8 * DAY + HOUR).toISOString());
    expect(view.treasury.ledger.map((l) => [l.delta, l.label])).toContainEqual([-2000, "Passed measure: The Walls of Nikaia"]);
    // A festival's spend reads "Festival held" (government prompt 3).
    expect(view.treasury.ledger.map((l) => [l.delta, l.label])).toContainEqual([-500, "Festival held: A Dionysia for 299 BC"]);
    // A war's spend reads "War declared on <nation>" (government prompt 4): a major
    // power by its name, a people with the article.
    expect(view.treasury.ledger.map((l) => [l.delta, l.label])).toContainEqual([-2000, "War declared on Carthage"]);
    expect(view.treasury.ledger.map((l) => [l.delta, l.label])).toContainEqual([-2001, "War declared on the Cadurci"]);
  });

  // --- The festival motion (government prompt 3) -------------------------------
  describe("the festival motion", () => {
    // A world in a Summer: season 2 of its first year, so the docket is for year 1.
    const firstSummer = () => world(new Date(Date.now() - 2 * DAY - HOUR));

    it("an Archon's festival docket in a Summer holds the coming year's three festivals with what they do; the public scope is empty while drafting", async () => {
      await firstSummer();
      const archon = await citizen("archon");
      await seat("archon", "palaioi", archon.characterId);
      const c = await citizen("citizen");

      const view = await government(archon.token);
      expect(view.member).toBe(true);
      if (!view.member) return;
      expect(view.festival.phase).toBe("drafting");
      expect(view.festival.cards.map((card) => card.id)).toEqual(["festival:dionysia:y1", "festival:artemisia:y1", "festival:apollo:y1"]);
      expect(view.festival.cards.map((card) => card.title)).toEqual(["A Dionysia for 299 BC", "An Artemisia for 299 BC", "A Festival of Apollo for 299 BC"]);
      for (const card of view.festival.cards) expect(card.effects).toEqual(festivalEffects(festivals.find((f) => `festival:${f.id}:y1` === card.id)!));
      expect(view.festival.youMayDraft).toBe(true);
      // The League's own docket is closed in a Summer.
      expect(view.league.phase).toBeNull();

      const scope = await festivalScope(c.token);
      expect(scope.phase).toBe("drafting");
      expect(scope.cards).toEqual([]);
      expect(scope.youMayDraft).toBe(false);
      // When the next dockets open (government prompt 3b): the League's in the
      // coming Winter, the festival's now.
      expect(scope.nextOpensLabel).toBe("Summer, 300 BC");
      const league = await leagueScope(c.token);
      expect(league.phase).toBeNull();
      expect(league.nextOpensLabel).toBe("Winter, 299 BC");
    });

    it("in an Olympiad year's Summer the docket holds the Olympiad too", async () => {
      // Year 7's Summer: the coming year, 8, is an Olympiad year (every 8).
      await world(new Date(Date.now() - (7 * 4 + 2) * DAY - HOUR));
      const archon = await citizen("archon");
      await seat("archon", "palaioi", archon.characterId);
      const view = await government(archon.token);
      expect(view.member && view.festival.cards.map((card) => card.id)).toEqual(["festival:dionysia:y8", "festival:artemisia:y8", "festival:apollo:y8", "festival:olympiad:y8"]);
      expect(view.member && view.festival.cards[3]!.title).toBe("The Olympiad of 292 BC");
    });

    it("once the festival has gone to the vote, the public scope shows the drafted festival alone, with its effects", async () => {
      // An Autumn: the real clock sits in season 3. The draft happened in its Summer.
      const startedAt = new Date(Date.now() - 3 * DAY - HOUR);
      await world(startedAt);
      const summer = new Date(startedAt.getTime() + 2 * DAY + HOUR);
      const archon = await citizen("archon");
      await seat("archon", "palaioi", archon.characterId);
      const c = await citizen("citizen");
      await m.agenda.syncAgenda(summer);
      expect((await m.agenda.draftCard(archon.row, "festival", "festival:apollo:y1", summer)).ok).toBe(true);

      const scope = await festivalScope(c.token);
      expect(scope.phase).toBe("voting");
      expect(scope.cards.map((card) => [card.id, card.title, card.effects])).toEqual([["festival:apollo:y1", "A Festival of Apollo for 299 BC", ["Traders and Shipbuilders +10 dr a season for the year"]]]);
      expect(scope.draftedCardId).toBe("festival:apollo:y1");
      expect(scope.youMayDraft).toBe(false);
      // In an Autumn the festival's next docket is the coming Summer's.
      expect(scope.nextOpensLabel).toBe("Summer, 299 BC");
    });
  });

  // The League's army (government prompt 5a): every member sees the whole of it.
  describe("the League's army", () => {
    it("a member sees the ten home towns by type, the fleet at Massalia, the season's upkeep and no desertion; a citizen sees none of it", async () => {
      await firstWinter();
      const strategos = await citizen("strategos");
      await seat("strategos", null, strategos.characterId);
      const c = await citizen("citizen");

      const view = await government(strategos.token);
      expect(view.member).toBe(true);
      if (!view.member) return;
      expect(view.army.men).toBe(2050);
      expect(view.army.upkeepPerSeason).toBe(513);
      expect(view.army.fleet).toEqual({ at: "Massalia", pentekonters: 29, triremes: 40, atSea: [] });
      expect(view.army.lastDesertion).toBeNull();
      // Before any order: no holding, no party, no order, no report.
      expect(view.army).toMatchObject({ holdings: [], parties: [], orders: [], reports: [], sightings: [] });
      expect(view.army.towns.map((t) => [t.townId, t.name, t.men])).toEqual([
        ["massalia", "Massalia", 1000],
        ["emporion", "Emporion", 250],
        ["nikaia", "Nikaia", 150],
        ["olbia-provence", "Olbia", 150],
        ["rhoda", "Rhoda", 120],
        ["agathe", "Agathe", 100],
        ["antipolis", "Antipolis", 100],
        ["arelate", "Arelate", 100],
        ["athinopolis", "Athinopolis", 50],
        ["monoikos", "Monoikos", 30],
      ]);
      expect(view.army.towns[0]!.units).toEqual({ hoplite: 500, peltast: 250, ekdromos: 150, hippeis: 100 });
      expect(view.army.towns[9]!.units).toEqual({ hoplite: 16, peltast: 7, ekdromos: 4, hippeis: 3 });
      expect(view.army.towns.reduce((n, t) => n + t.men, 0)).toBe(2050);

      expect(await government(c.token)).toEqual({ member: false });
    });

    it("once men have deserted the view names how many and the season, the towns show what stands, and the ledger reads the count", async () => {
      await firstWinter();
      const archon = await citizen("archon");
      await seat("archon", "palaioi", archon.characterId);
      await government(archon.token); // the first sync raises the army
      const league = (await m.dbPkg.leaguePlayerId(db, worldId))!;
      // As a season the treasury could not pay would leave it: Monoikos emptied,
      // Massalia's hoplites thinned, and the desertion's row on the ledger.
      await db.delete(m.dbPkg.playerUnits).where(and(eq(m.dbPkg.playerUnits.ownerPlayerId, league), eq(m.dbPkg.playerUnits.basedAt, "monoikos")));
      await db.update(m.dbPkg.playerUnits).set({ count: 98 }).where(and(eq(m.dbPkg.playerUnits.ownerPlayerId, league), eq(m.dbPkg.playerUnits.basedAt, "massalia"), eq(m.dbPkg.playerUnits.unitId, "hoplite")));
      await db.insert(m.dbPkg.treasuryLedger).values({ worldId, owner: "league", delta: 0, reason: "desertion:s2:432" });
      // A later season the treasury could not pay at all: its claim at 0.
      await db.insert(m.dbPkg.treasuryLedger).values({ worldId, owner: "league", delta: 0, reason: "army:s3" });

      const view = await government(archon.token);
      expect(view.member).toBe(true);
      if (!view.member) return;
      expect(view.army.men).toBe(2050 - 30 - 402);
      expect(view.army.upkeepPerSeason).toBe(Math.round((2050 - 30 - 402) * 0.25));
      expect(view.army.towns[0]).toMatchObject({ name: "Massalia", units: { hoplite: 98, peltast: 250, ekdromos: 150, hippeis: 100 }, men: 598 });
      expect(view.army.towns[9]).toEqual({ townId: "monoikos", name: "Monoikos", units: { hoplite: 0, peltast: 0, ekdromos: 0, hippeis: 0 }, men: 0 });
      expect(view.army.lastDesertion).toEqual({ men: 432, label: "Summer, 300 BC" });
      expect(view.treasury.ledger.map((l) => [l.delta, l.label])).toContainEqual([0, "Deserted for want of pay: 432 men"]);
      // The first season was paid; the one at 0 reads as unpaid.
      expect(view.treasury.ledger.map((l) => [l.delta, l.label])).toContainEqual([-513, "Army upkeep"]);
      expect(view.treasury.ledger.map((l) => [l.delta, l.label])).toContainEqual([0, "Army upkeep unpaid"]);
    });

    // Government prompt 5b: the army takes orders, and every member sees the whole of it.
    it("once the army has orders, every member sees it whole: the men standing in each town and holding, the parties on the road, the hulls at sea, the latest orders with who gave them, the latest reports, and the army's rows on the ledger by place", async () => {
      await firstWinter();
      const archon = await citizen("archon");
      await seat("archon", "dynatoi", archon.characterId);
      const ephor = await citizen("ephor");
      await seat("ephor", "palaioi", ephor.characterId);
      const c = await citizen("citizen");
      await government(ephor.token); // the first sync raises the army
      const league = (await m.dbPkg.leaguePlayerId(db, worldId))!;
      const { playerUnits, playerMarches, playerVoyages, playerHoldings, leagueOrders, resources, treasuryLedger } = m.dbPkg;
      const now = new Date();
      const inMinutes = (n: number) => new Date(now.getTime() + n * 60_000);
      const standing = (unitId: string, count: number) => db.update(playerUnits).set({ count }).where(and(eq(playerUnits.ownerPlayerId, league), eq(playerUnits.basedAt, "massalia"), eq(playerUnits.unitId, unitId)));
      const onTheRoad = (unitId: string, count: number, movingTo: string, arrivesAt: Date, mission: Record<string, unknown>) =>
        db.insert(playerUnits).values({ worldId, ownerPlayerId: league, source: "trained", unitId, count, startCount: count, recruitedSeason: 0, readyAt: now, basedAt: "massalia", movingTo, arrivesAt, mission: { departedAt: now.toISOString(), ...mission } as never });
      const march = async (kind: "scout" | "raid", regionId: string, townId: string | null, arrivesAt: Date, done?: { line: string; intel?: Record<string, unknown> }) =>
        (await db.insert(playerMarches).values({ worldId, ownerPlayerId: league, kind, regionId, townId, baseId: "massalia", route: "land", steps: 1, minutes: 30, departedAt: new Date(arrivesAt.getTime() - 30 * 60_000), arrivesAt, ...(done ? { status: "resolved" as const, resolvedAt: arrivesAt, report: done } : {}) }).returning())[0]!.id;
      const orderRow = (o: { kind: "move" | "scout" | "raid" | "attack"; regionId: string; townId: string | null; force: { unitId: string; count: number }[]; marchId: string | null; orderedAt: Date; suppliesCost?: number }) =>
        db.insert(leagueOrders).values({ worldId, orderedByCharacterId: archon.characterId, orderedByName: "Seskios", office: "archon", side: "dynatoi", kind: o.kind, baseId: "massalia", regionId: o.regionId, townId: o.townId, men: o.force.reduce((n, f) => n + f.count, 0), force: o.force, ships: {}, supplies: 0, suppliesCost: o.suppliesCost ?? 0, marchId: o.marchId, report: null, orderedAt: o.orderedAt, arrivesAt: inMinutes(30) }).returning();

      // As four orders leave it. 40 peltasts are out on a raid on Reii.
      const raid = await march("raid", "R047", "reii", inMinutes(20));
      await standing("peltast", 210);
      await onTheRoad("peltast", 40, "reii", inMinutes(20), { kind: "raid", regionId: "R047", townId: "reii", marchId: raid });
      const raidOrder = (await orderRow({ kind: "raid", regionId: "R047", townId: "reii", force: [{ unitId: "peltast", count: 40 }], marchId: raid, orderedAt: new Date(now.getTime() - 10 * 60_000) }))[0]!;
      // 5 riders are on their way home from a scout of the Salyes, which reported.
      const scout = await march("scout", "R046", null, new Date(now.getTime() - 20 * 60_000), { line: "Scouted Salyes with 5 hippeis: a warband of 100.", intel: { warband: 100, scoutedGameDate: "Winter, 300 BC" } });
      // An older scout of Aleria saw its garrison and its ships.
      await march("scout", "R073", "aleria", new Date(now.getTime() - 90 * 60_000), { line: "Scouted Aleria with 5 hippeis.", intel: { warband: 150, pentekonters: 4, triremes: 4, scoutedGameDate: "Winter, 300 BC" } });
      await standing("hippeis", 95);
      await onTheRoad("hippeis", 5, "massalia", inMinutes(10), { kind: "scout", regionId: "R046" });
      await orderRow({ kind: "scout", regionId: "R046", townId: null, force: [{ unitId: "hippeis", count: 5 }], marchId: scout, orderedAt: new Date(now.getTime() - 50 * 60_000) });
      // 30 hoplites and 10 ekdromoi are moving to Arelate.
      await standing("hoplite", 470);
      await standing("ekdromos", 140);
      await onTheRoad("hoplite", 30, "arelate", inMinutes(30), { kind: "move", regionId: "R052", townId: "arelate" });
      await onTheRoad("ekdromos", 10, "arelate", inMinutes(30), { kind: "move", regionId: "R052", townId: "arelate" });
      await orderRow({ kind: "move", regionId: "R052", townId: "arelate", force: [{ unitId: "hoplite", count: 30 }, { unitId: "ekdromos", count: 10 }], marchId: null, orderedAt: new Date(now.getTime() - 5 * 60_000), suppliesCost: 28 });
      // The League holds the Corsi's land with 12 peltasts, and two pentekonters are at sea for Thapsus.
      await db.insert(playerHoldings).values({ worldId, regionId: "R078", townId: "", ownerPlayerId: league, kind: "conquest", previousOwner: "unclaimed", since: now, lastGarrisonedAt: now, lastTributeAt: now });
      await db.insert(playerUnits).values({ worldId, ownerPlayerId: league, source: "trained", unitId: "peltast", count: 12, startCount: 12, recruitedSeason: 0, readyAt: now, basedAt: "R078" });
      await db.update(resources).set({ amount: "27" }).where(and(eq(resources.scopeId, league), eq(resources.type, "trade-ship")));
      await db.insert(playerVoyages).values({ worldId, ownerPlayerId: league, ships: { "trade-ship": 2 }, kind: "raid", regionId: "R135", townId: "thapsus", sailedAt: now, returnsAt: inMinutes(300) });
      // The army's three kinds of ledger row, after the first sync's own rows.
      const after = (seconds: number) => new Date(now.getTime() + seconds * 1000);
      await db.insert(treasuryLedger).values([
        { worldId, owner: "league", delta: -28, reason: `supplies:${raidOrder.id}`, createdAt: after(1) },
        { worldId, owner: "league", delta: 310, reason: `plunder:reii:${raid}`, createdAt: after(2) },
        { worldId, owner: "league", delta: 40, reason: "tribute:R078:d20000", createdAt: after(3) },
      ]);

      // An Ephor orders nothing, and sees all of it.
      const view = await government(ephor.token);
      expect(view.member).toBe(true);
      if (!view.member) return;
      const army = view.army;
      // Massalia shows the men standing in it; Arelate does not yet count the men marching to it.
      expect(army.towns[0]).toEqual({ townId: "massalia", name: "Massalia", units: { hoplite: 470, peltast: 210, ekdromos: 140, hippeis: 95 }, men: 915 });
      expect(army.towns.find((t) => t.townId === "arelate")).toMatchObject({ men: 100 });
      expect(army.holdings).toEqual([{ id: "R078", name: "Corsi", units: { hoplite: 0, peltast: 12, ekdromos: 0, hippeis: 0 }, men: 12, minGarrison: expect.any(Number) }]);
      // The parties, soonest first: the riders home, the raid out, the move as one party of two types.
      expect(army.parties.map(({ arrivesAt: _arrivesAt, ...p }) => p)).toEqual([
        { kind: "scout", returning: true, from: "Salyes", to: "Massalia", units: { hoplite: 0, peltast: 0, ekdromos: 0, hippeis: 5 }, men: 5 },
        { kind: "raid", returning: false, from: "Massalia", to: "Reii", units: { hoplite: 0, peltast: 40, ekdromos: 0, hippeis: 0 }, men: 40 },
        { kind: "move", returning: false, from: "Massalia", to: "Arelate", units: { hoplite: 30, peltast: 0, ekdromos: 10, hippeis: 0 }, men: 40 },
      ]);
      expect(army.parties[1]!.arrivesAt).toBe(inMinutes(20).toISOString());
      // Every man is under arms and paid for, wherever he is.
      expect(army.men).toBe(2050 + 12);
      expect(army.towns.reduce((n, t) => n + t.men, 0) + army.holdings[0]!.men + army.parties.reduce((n, p) => n + p.men, 0)).toBe(2050 + 12);
      expect(army.upkeepPerSeason).toBe(Math.round((2050 + 12) * 0.25));
      expect(army.fleet).toEqual({ at: "Massalia", pentekonters: 27, triremes: 40, atSea: [{ pentekonters: 2, triremes: 0, to: "Thapsus", returnsAt: inMinutes(300).toISOString() }] });
      // The orders, newest first, each with who gave it and from which seat.
      // The name is the one the order kept, whatever the players row is called now (an heir takes the row).
      const by = "Seskios";
      expect(army.orders.map((o) => [o.kind, o.by, o.office, o.side, o.from, o.to, o.men, o.suppliesCost])).toEqual([
        ["move", by, "archon", "dynatoi", "Massalia", "Arelate", 40, 28],
        ["raid", by, "archon", "dynatoi", "Massalia", "Reii", 40, 0],
        ["scout", by, "archon", "dynatoi", "Massalia", "Salyes", 5, 0],
      ]);
      expect(army.orders[0]!.units).toEqual({ hoplite: 30, peltast: 0, ekdromos: 10, hippeis: 0 });
      expect(army.orders[0]!.dateLabel).toBe(view.treasury.ledger[0]!.dateLabel);
      // The reports: the party that has arrived, in the server's sentence. The raid has not.
      expect(army.reports[0]).toEqual({ id: scout, kind: "scout", to: "Salyes", line: "Scouted Salyes with 5 hippeis: a warband of 100.", dateLabel: expect.any(String), arrivedAt: new Date(now.getTime() - 20 * 60_000).toISOString() });
      expect(army.reports.map((r) => r.to)).toEqual(["Salyes", "Aleria"]);
      // What the League's parties saw is the League's, for every member: by place, with its date.
      expect(army.sightings).toEqual([
        { id: "aleria", name: "Aleria", town: true, men: 150, pentekonters: 4, triremes: 4, asOf: "Winter, 300 BC" },
        { id: "R046", name: "Salyes", town: false, men: 100, pentekonters: 0, triremes: 0, asOf: "Winter, 300 BC" },
      ]);
      // No house's intel holds any of it.
      expect(await db.select().from(m.dbPkg.townIntel)).toEqual([]);
      expect(await db.select().from(m.dbPkg.regionIntel)).toEqual([]);
      // The ledger names the army's rows, the place by its name.
      expect(view.treasury.ledger.slice(0, 3).map((l) => [l.delta, l.label])).toEqual([[40, "Tribute of Corsi"], [310, "Plunder of Reii"], [-28, "Naval supplies"]]);

      // The Archon sees the same; a citizen none of it.
      const same = await government(archon.token);
      expect(same.member && same.army).toEqual(army);
      expect(await government(c.token)).toEqual({ member: false });
    });
  });

  // The war motion (government prompt 4): drafted in Spring, voted in Summer.
  describe("the war motion", () => {
    const warScope = async (token: string) => ((await get("/api/agenda", token)).json() as { war: Scope }).war;
    const WAR_EFFECTS = ["Raids on the enemy's land +50% plunder", "Peace after 2 years, at Hostile"];
    // A world in its first Spring: season 1, so the docket is year 0's.
    const firstSpring = () => world(new Date(Date.now() - DAY - HOUR));

    it("an Archon's war docket in a Spring holds the six nations below 0 with what a war does; the public scope is empty while drafting", async () => {
      await firstSpring();
      const archon = await citizen("archon");
      await seat("archon", "palaioi", archon.characterId);
      const c = await citizen("citizen");

      const view = await government(archon.token);
      expect(view.member).toBe(true);
      if (!view.member) return;
      expect(view.war.phase).toBe("drafting");
      expect(view.war.cards.map((card) => [card.id, card.title])).toEqual([
        ["war:cadurci:y0", "War on the Cadurci"],
        ["war:volcae:y0", "War on the Volcae"],
        ["war:allobroges:y0", "War on the Allobroges"],
        ["war:saluvii:y0", "War on the Saluvii"],
        ["war:tarusates:y0", "War on the Tarusates"],
        ["war:carthage:y0", "War on Carthage"],
      ]);
      for (const card of view.war.cards) expect(card.effects).toEqual(WAR_EFFECTS);
      expect(view.war.youMayDraft).toBe(true);
      expect(view.war.treasury.balance).toBeGreaterThanOrEqual(60_000);

      const scope = await warScope(c.token);
      expect(scope.phase).toBe("drafting");
      expect(scope.cards).toEqual([]);
      expect(scope.draftedCardId).toBeNull();
      expect(scope.youMayDraft).toBe(false);
      expect(scope.nextOpensLabel).toBe("Spring, 300 BC");
    });

    it("once the war has gone to the vote, the public scope shows the drafted war alone, with its effects", async () => {
      // A Summer: the real clock sits in season 2. The draft happened in its Spring.
      const startedAt = new Date(Date.now() - 2 * DAY - HOUR);
      await world(startedAt);
      const spring = new Date(startedAt.getTime() + DAY + HOUR);
      const archon = await citizen("archon");
      await seat("archon", "palaioi", archon.characterId);
      const c = await citizen("citizen");
      await m.agenda.syncAgenda(spring);
      expect((await m.agenda.draftCard(archon.row, "war", "war:carthage:y0", spring)).ok).toBe(true);

      const scope = await warScope(c.token);
      expect(scope.phase).toBe("voting");
      expect(scope.cards.map((card) => [card.id, card.title, card.effects])).toEqual([["war:carthage:y0", "War on Carthage", WAR_EFFECTS]]);
      expect(scope.draftedCardId).toBe("war:carthage:y0");
      expect(scope.youMayDraft).toBe(false);
      // In a Summer the war's next docket is the coming Spring's.
      expect(scope.nextOpensLabel).toBe("Spring, 299 BC");
    });

    it("an Ephor who used the League's veto this term may not veto a drafted war; another Ephor may", async () => {
      // A Spring; the League's docket was drafted and vetoed in its Winter.
      const startedAt = new Date(Date.now() - DAY - HOUR);
      await world(startedAt);
      const winter = new Date(startedAt.getTime() + HOUR);
      const archon = await citizen("archon");
      const spent = await citizen("spent", "dynatoi");
      const fresh = await citizen("fresh");
      await seat("archon", "palaioi", archon.characterId);
      await seat("ephor", "dynatoi", spent.characterId);
      await seat("ephor", "palaioi", fresh.characterId);
      await m.agenda.syncAgenda(winter);
      const cycle = (await db.select().from(m.dbPkg.agendaCycles).where(and(eq(m.dbPkg.agendaCycles.worldId, worldId), eq(m.dbPkg.agendaCycles.scope, "league"))).limit(1))[0]!;
      expect((await m.agenda.draftCard(archon.row, "league", (cycle.cardIds as string[])[0]!, winter)).ok).toBe(true);
      expect((await m.agenda.vetoCard(spent.row, "league", winter)).ok).toBe(true);

      // The Spring: the Archon puts a war forward.
      expect((await m.agenda.draftCard(archon.row, "war", "war:volcae:y0")).ok).toBe(true);
      const spentView = await government(spent.token);
      expect(spentView.member && spentView.war.draftedCardId).toBe("war:volcae:y0");
      expect(spentView.member && spentView.war.youMayVeto).toBe(false);
      const freshView = await government(fresh.token);
      expect(freshView.member && freshView.war.youMayVeto).toBe(true);
      // The veto itself answers the same way, and a war's veto is recorded under the League.
      expect(await m.agenda.vetoCard(spent.row, "war")).toMatchObject({ ok: false, code: 409 });
      expect((await m.agenda.vetoCard(fresh.row, "war")).ok).toBe(true);
      const vetoes = await db.select({ scope: m.dbPkg.ephorVetoes.scope }).from(m.dbPkg.ephorVetoes).where(eq(m.dbPkg.ephorVetoes.worldId, worldId));
      expect(vetoes.map((v) => v.scope)).toEqual(["league", "league"]);
      const after = await government(fresh.token);
      expect(after.member && after.war.vetoedCardId).toBe("war:volcae:y0");
      expect(after.member && after.war.youMayVeto).toBe(false);
    });
  });

  // A world whose docket has gone to the vote: started a day and an hour back,
  // so the real clock sits in its Spring. The draft and the veto happen through
  // the services with a `now` in its Winter, the way they did when it was live.
  describe("the public scope once the docket has gone to the vote", () => {
    async function votingWorld(sequence: "draft" | "draft-veto" | "draft-veto-draft") {
      const startedAt = new Date(Date.now() - DAY - HOUR);
      await world(startedAt);
      const winter = new Date(startedAt.getTime() + HOUR);
      const archon = await citizen("archon");
      const ephor = await citizen("ephor", "dynatoi");
      const c = await citizen("citizen");
      await seat("archon", "palaioi", archon.characterId);
      await seat("ephor", "dynatoi", ephor.characterId);
      await m.agenda.syncAgenda(winter);
      const cycle = (await db.select().from(m.dbPkg.agendaCycles).where(and(eq(m.dbPkg.agendaCycles.worldId, worldId), eq(m.dbPkg.agendaCycles.scope, "league"))).limit(1))[0]!;
      expect(cycle.phase).toBe("drafting");
      const [first, second] = cycle.cardIds as string[];
      expect((await m.agenda.draftCard(archon.row, "league", first!, winter)).ok).toBe(true);
      if (sequence !== "draft") expect((await m.agenda.vetoCard(ephor.row, "league", winter)).ok).toBe(true);
      if (sequence === "draft-veto-draft") expect((await m.agenda.draftCard(archon.row, "league", second!, winter)).ok).toBe(true);
      return { c, first: first!, second: second! };
    }

    it("shows the drafted card alone", async () => {
      const { c, first } = await votingWorld("draft");
      const scope = await leagueScope(c.token);
      expect(scope.phase).toBe("voting");
      expect(scope.cards.map((card) => card.id)).toEqual([first]);
      const project = startDocket.find((p) => p.id === first)!;
      expect(scope.cards[0]!.effects).toEqual(buildingEffects(buildings.find((b) => b.id === project.buildingId)!, project.polis));
      expect(scope.draftedCardId).toBe(first);
      expect(scope.vetoedCardId).toBeNull();
      expect(scope.youMayDraft).toBe(false);
      expect(scope.youMayVeto).toBe(false);
    });

    it("shows nothing when the drafted card was vetoed", async () => {
      const { c } = await votingWorld("draft-veto");
      const scope = await leagueScope(c.token);
      expect(scope.phase).toBe("voting");
      expect(scope.cards).toEqual([]);
      expect(scope.draftedCardId).toBeNull();
      expect(scope.vetoedCardId).toBeNull();
    });

    it("shows the second card after a draft, a veto and a second draft", async () => {
      const { c, second } = await votingWorld("draft-veto-draft");
      const scope = await leagueScope(c.token);
      expect(scope.phase).toBe("voting");
      expect(scope.cards.map((card) => card.id)).toEqual([second]);
      expect(scope.draftedCardId).toBe(second);
      expect(scope.vetoedCardId).toBeNull();
    });
  });
});
