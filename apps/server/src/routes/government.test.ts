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
  return { dbPkg, agendaRoutes, governmentRoutes, agenda, loadPoliticsConfig, getPoliticsConfig, loadCalendarConfig };
}
type Mods = Awaited<ReturnType<typeof loadModules>>;

type Scope = { phase: string | null; cards: { id: string; title: string; group?: string; seasons?: number; effects?: string[] }[]; draftedCardId: string | null; vetoedCardId: string | null; treasury: { balance: number; ledger: unknown[] }; youMayDraft: boolean; youMayVeto: boolean };
type Gov =
  | { member: false }
  | {
      member: true;
      seats: { office: string; side: string | null }[];
      treasury: { balance: number; taxPerSeason: number; ledger: { delta: number; label: string; dateLabel: string; createdAt: string }[] };
      projects: { cityId: string; polis: string; buildingId: string; title: string; status: string; completesAt: string; completesLabel: string }[];
      league: Scope;
      festival: Scope;
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
    await db.execute(sql`TRUNCATE TABLE league_projects, party_endorsements, ephor_vetoes, agenda_cycles, treasury_ledger, treasuries, league_cities, world_treasury,
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
    // The sync credited the opening balance, the first Winter's tax and the levy.
    expect(scope.treasury.balance).toBe(60_000 + 910 + m.getPoliticsConfig().treasury.leviedPerSeason);
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
    expect(view.treasury.balance).toBe(60_000 + 910 + m.getPoliticsConfig().treasury.leviedPerSeason);
    expect(view.treasury.taxPerSeason).toBe(910);
    const lines = view.treasury.ledger.map((l) => [l.delta, l.label, l.dateLabel]);
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
