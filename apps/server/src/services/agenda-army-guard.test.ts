import { and, eq, sql } from "drizzle-orm";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// The army must never stop anything else (government prompt 5a, ruling 9 at
// STOP 1). GET /me/state awaits syncAgenda, and the agenda sync opens the
// dockets; with the army's settle forced to throw, the sync still completes,
// credits the treasury and opens the cycle that is due, and says what failed.
// The whole @massalia/db module is real but for settleLeagueArmy.
// Integration test against a REAL Postgres, guarded to a *_test database.
// ---------------------------------------------------------------------------

vi.mock("@massalia/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@massalia/db")>();
  return {
    ...actual,
    settleLeagueArmy: vi.fn(async () => {
      throw new Error("the army settle broke");
    }),
  };
});

const dbUrl = process.env.DATABASE_URL ?? "";
const suite = describe.runIf(dbUrl.includes("_test"));

const SEASON = 86_400_000;
const T0 = Date.UTC(2000, 0, 1);
const at = (season: number) => new Date(T0 + Math.round((season + 0.5) * SEASON));

async function loadModules() {
  const dbPkg = await import("@massalia/db");
  const agenda = await import("./agenda.js");
  const oligarchy = await import("./oligarchy.js");
  const festival = await import("./festival.js");
  return { dbPkg, agenda, oligarchy, festival };
}
type Mods = Awaited<ReturnType<typeof loadModules>>;

suite("the agenda sync with a failing army (integration)", () => {
  let m: Mods;
  let db: ReturnType<Mods["dbPkg"]["createDb"]>;
  let worldId: string;

  beforeAll(async () => {
    m = await loadModules();
    db = m.dbPkg.createDb();
    await m.oligarchy.loadPoliticsConfig();
    await m.festival.loadCalendarConfig();
    await m.agenda.loadAgendaContent();
  });

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE league_wars, faction_relations, league_festivals, league_projects, league_cities, party_endorsements, ephor_vetoes, agenda_cycles, treasury_ledger, treasuries,
      election_votes, election_candidates, elections, office_history, offices, chamber_ballots, chamber_votes,
      oligarch_seats, party_favor, effect_log, character_traits, player_characters, dynasties, players, sessions, users, worlds CASCADE`);
    worldId = (await db.insert(m.dbPkg.worlds).values({ name: "Army Guard", seed: "aguard", startedAt: new Date(T0), endsAt: new Date(T0 + 182 * SEASON), status: "active" }).returning())[0]!.id;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("the settle throws: the sync still completes, credits the season's revenue, opens the due docket and logs what failed", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    // Year 2's Spring (season 9): the war docket is due to open.
    const result = await m.agenda.syncAgenda(at(9));
    expect(vi.mocked(m.dbPkg.settleLeagueArmy)).toHaveBeenCalled();
    expect(logged.mock.calls.map((c) => c[0])).toContain("army: failed the army settle broke");

    expect(result.opened).toBeGreaterThanOrEqual(1);
    const cycles = await db.select({ scope: m.dbPkg.agendaCycles.scope, phase: m.dbPkg.agendaCycles.phase, gameYear: m.dbPkg.agendaCycles.gameYear }).from(m.dbPkg.agendaCycles).where(eq(m.dbPkg.agendaCycles.worldId, worldId));
    expect(cycles).toContainEqual({ scope: "war", phase: "drafting", gameYear: 2 });
    // The revenue before the army is in, and nothing was charged for an army.
    const ledger = await db.select({ reason: m.dbPkg.treasuryLedger.reason }).from(m.dbPkg.treasuryLedger).where(and(eq(m.dbPkg.treasuryLedger.worldId, worldId), eq(m.dbPkg.treasuryLedger.owner, "league")));
    expect(ledger.map((l) => l.reason)).toEqual(expect.arrayContaining(["opening", "tax:s9"]));
    expect(ledger.some((l) => l.reason.startsWith("army:"))).toBe(false);

    // The next sync tries the army again, and goes on again.
    await m.agenda.syncAgenda(at(9));
    expect(vi.mocked(m.dbPkg.settleLeagueArmy)).toHaveBeenCalledTimes(2);
  });
});
