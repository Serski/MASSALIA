import { describe, expect, it, beforeAll, beforeEach } from "vitest";
import { and, eq, sql } from "drizzle-orm";

// ---------------------------------------------------------------------------
// The hoplite's mercenary contracts — STATE + SAFE go/return lifecycle (Step 2).
// Integration tests against a REAL Postgres, guarded to a *_test database (mirrors
// service.test.ts). Covers: take (home salary pauses, foreign income accrues),
// accrue+collect, auto-complete at term (lazy + worker sweep), cancel gating,
// eligibility rejections, and the CRITICAL regression: a hoplite ON CONTRACT still
// satisfies the voting gate (status stays "alive" — no presence check added).
// ---------------------------------------------------------------------------

const dbUrl = process.env.DATABASE_URL ?? "";
const suite = describe.runIf(dbUrl.includes("_test"));

const DAY = 86_400_000; // REAL_MS_PER_SEASON — one season
const T0 = Date.UTC(2000, 0, 1);
const at = (seasons: number) => new Date(T0 + seasons * DAY);

async function loadModules() {
  const dbPkg = await import("@massalia/db");
  const merc = await import("./merc.js");
  const service = await import("./service.js");
  const age = await import("./age.js");
  const traits = await import("./traits.js");
  const routines = await import("./routines.js");
  const composure = await import("./composure.js");
  return { dbPkg, merc, service, age, traits, routines, composure };
}
type Mods = Awaited<ReturnType<typeof loadModules>>;

suite("Mercenary contracts (integration)", () => {
  let m: Mods;
  let db: ReturnType<Mods["dbPkg"]["createDb"]>;
  let worldId: string;

  async function makeHoplite(opts: { militia?: number; prestige?: number; drachmae?: number; classId?: string; rank?: string } = {}) {
    const { users, players, playerCharacters } = m.dbPkg;
    const user = (await db.insert(users).values({ email: `u-${Math.random().toString(36).slice(2)}@t`, passwordHash: "x" }).returning())[0]!;
    const player = (await db.insert(players).values({ worldId, userId: user.id, name: "H", color: "#123456", houseSlug: "test-house" }).returning())[0]!;
    return (await db
      .insert(playerCharacters)
      .values({
        playerId: player.id,
        worldId,
        houseSlug: "test-house",
        classId: opts.classId ?? "hoplite",
        militia: opts.militia ?? 0,
        prestige: opts.prestige ?? 0,
        drachmae: opts.drachmae ?? 0,
        armyRank: opts.rank ?? "none",
        startAge: 30,
        deathAge: 90,
      })
      .returning())[0]!;
  }
  async function reload(id: string) {
    return (await db.select().from(m.dbPkg.playerCharacters).where(eq(m.dbPkg.playerCharacters.id, id)).limit(1))[0]!;
  }
  async function heldTraitIds(id: string): Promise<string[]> {
    const rows = await db.select({ traitId: m.dbPkg.characterTraits.traitId }).from(m.dbPkg.characterTraits).where(eq(m.dbPkg.characterTraits.characterId, id));
    return rows.map((r) => r.traitId).sort();
  }

  beforeAll(async () => {
    m = await loadModules();
    db = m.dbPkg.createDb();
    await m.merc.loadContractsContent();
    await m.service.loadRanksContent();
    await m.age.loadAgeConfig();
    await m.traits.loadTraitDefs();
    await m.routines.loadRoutineContent();
    await m.composure.loadComposureConfig();
  });

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE character_traits, offices, player_characters, dynasties, players, sessions, users, worlds CASCADE`);
    await db.insert(m.dbPkg.houses).values({ slug: "test-house", name: "House Test", initial: "T", alignment: "c", stance: "s", motto: "m", patron: "p", crest: "c" }).onConflictDoNothing();
    const world = (await db.insert(m.dbPkg.worlds).values({ name: "Merc Test", seed: "mtest", startedAt: new Date(T0), endsAt: new Date(T0 + 182 * DAY), status: "active" }).returning())[0]!;
    worldId = world.id;
  });

  it("takes a contract: home salary pauses, foreign income accrues per season", async () => {
    // A veteran (home salary 16/day) takes the trade-ship (foreign 12/season, term 1).
    const c = await makeHoplite({ rank: "veteran", militia: 20, prestige: 12, drachmae: 0 });
    const taken = await m.merc.takeContract(c, "trade-ship", at(0));
    expect(taken.ok).toBe(true);
    const row = await reload(c.id);
    expect(row.contractId).toBe("trade-ship");
    expect(row.contractStartedAt?.getTime()).toBe(T0);
    expect(row.contractSeasonsTotal).toBe(1);

    // Home salary is PAUSED while abroad — the rank status shows no home accrual.
    const status = m.service.serviceStatus(row, at(0.5));
    expect(status.abroad).toBe(true);
    expect(status.accrued.drachmae).toBe(0);

    // Foreign income accrues instead: 12/season → 6 at half a season.
    const board = await m.merc.board(row, at(0.5));
    expect(board.current?.accrued).toBe(6);
  });

  it("collects foreign income mid-term, then the contract auto-completes at term (lazy)", async () => {
    const c = await makeHoplite({ drachmae: 0 });
    await m.merc.takeContract(c, "trade-ship", at(0)); // gate 0/0

    const collected = await m.merc.collectForeign(await reload(c.id), at(0.5));
    expect(collected.ok).toBe(true);
    if (collected.ok) expect(collected.collected).toBe(6);
    expect((await reload(c.id)).drachmae).toBe(6);
    expect((await reload(c.id)).contractId).toBe("trade-ship"); // still serving

    // At/after the 1-season term, a board read lazily completes + returns home.
    const board = await m.merc.board(await reload(c.id), at(1));
    expect(board.abroad).toBe(false);
    expect(board.current).toBeNull();
    const home = await reload(c.id);
    expect(home.contractId).toBeNull();
    expect(home.drachmae).toBe(12); // full term 12/season × 1 (6 collected + 6 final)
    expect(home.lastSalaryAt?.getTime()).toBe(at(1).getTime()); // home salary anchor reset to return
  });

  it("the worker sweep completes a served-out contract for an offline player", async () => {
    const c = await makeHoplite({ drachmae: 0 });
    await m.merc.takeContract(c, "trade-ship", at(0));
    // Player never opens the app; the sweep runs after the term (real content cfg).
    const swept = await m.dbPkg.sweepMercenaryContracts(m.merc.contractCfgMap(), m.traits.getAllTraitDefs(), at(1));
    expect(swept.completed).toBe(1);
    const home = await reload(c.id);
    expect(home.contractId).toBeNull();
    expect(home.drachmae).toBe(12);
    // The sweep also awarded the completion trait for an offline player.
    expect(await heldTraitIds(c.id)).toContain("sellsword");
  });

  it("gates early return on minCancelSeasons; allows an early return inside the window", async () => {
    // Syracuse: term 2, minCancel 2. Cancel is blocked before season 2.
    const sy = await makeHoplite({ militia: 25, prestige: 20, drachmae: 0 });
    await m.merc.takeContract(sy, "syracuse", at(0));
    const tooEarly = await m.merc.cancelContract(await reload(sy.id), at(1));
    expect(tooEarly.ok).toBe(false);
    if (!tooEarly.ok) expect(tooEarly.code).toBe(409);
    expect((await reload(sy.id)).contractId).toBe("syracuse"); // still sworn

    const okCancel = await m.merc.cancelContract(await reload(sy.id), at(2));
    expect(okCancel.ok).toBe(true);
    expect((await reload(sy.id)).contractId).toBeNull();

    // Trade-ship: minCancel 0 → a genuine early return mid-term (before season 1).
    const ts = await makeHoplite({ drachmae: 0 });
    await m.merc.takeContract(ts, "trade-ship", at(0));
    const early = await m.merc.cancelContract(await reload(ts.id), at(0.5));
    expect(early.ok).toBe(true);
    const home = await reload(ts.id);
    expect(home.contractId).toBeNull();
    expect(home.drachmae).toBe(6); // income earned so far (half a season)
  });

  it("rejects ineligible takers: non-hoplite, gate-short, already-abroad, and a Strategos", async () => {
    // Non-hoplite.
    const trader = await makeHoplite({ classId: "trader" });
    const t = await m.merc.takeContract(trader, "trade-ship", at(0));
    expect(t.ok).toBe(false);
    if (!t.ok) expect(t.code).toBe(403);

    // Gate-short: low stats taking the Ptolemaic guard (needs 50/45).
    const weak = await makeHoplite({ militia: 5, prestige: 5 });
    const g = await m.merc.takeContract(weak, "ptolemy", at(0));
    expect(g.ok).toBe(false);
    if (!g.ok) expect(g.code).toBe(403);

    // Already on a contract.
    const busy = await makeHoplite();
    await m.merc.takeContract(busy, "trade-ship", at(0));
    const again = await m.merc.takeContract(await reload(busy.id), "trade-ship", at(0.1));
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.code).toBe(409);

    // A sitting Strategos cannot be sworn abroad.
    const strat = await makeHoplite({ militia: 60, prestige: 60 });
    await db.insert(m.dbPkg.offices).values({ worldId, office: "strategos", side: null, seatSlot: 0, holderCharacterId: strat.id, acquiredVia: "appointed", termStartedYear: 1 });
    const s = await m.merc.takeContract(strat, "trade-ship", at(0));
    expect(s.ok).toBe(false);
    if (!s.ok) expect(s.code).toBe(409);
  });

  it("REGRESSION: a hoplite on contract still satisfies the voting gate (status 'alive')", async () => {
    const c = await makeHoplite({ militia: 20, prestige: 12 });
    await m.merc.takeContract(c, "trade-ship", at(0));
    const row = await reload(c.id);
    // Chamber + election voting gate ONLY on status === "alive" (oligarchy.ts:78,
    // elections.ts:142) — never on presence/contract. Being abroad leaves status
    // untouched, so the vote still counts (proxy voting, by construction).
    expect(row.contractId).toBe("trade-ship");
    expect(row.status).toBe("alive");
  });

  // --- Step 3: completion trait awards ---------------------------------------

  it("awards the mapped completion traits on successful term completion (per contract)", async () => {
    // Gaulish caravan (term 1) → sellsword + polyglot.
    const c = await makeHoplite({ militia: 15, prestige: 10 });
    await m.merc.takeContract(c, "gaul-caravan", at(0));
    const done = await m.merc.collectForeign(await reload(c.id), at(1)); // collect at term → completes
    expect(done.ok).toBe(true);
    if (done.ok) expect(done.completed).toBe(true);
    expect(await heldTraitIds(c.id)).toEqual(["polyglot", "sellsword"]);
    expect((await reload(c.id)).contractId).toBeNull();
  });

  it("does NOT double-award when the contract is already complete (idempotent)", async () => {
    const c = await makeHoplite({ militia: 25, prestige: 20 });
    await m.merc.takeContract(c, "syracuse", at(0)); // → sellsword + shield-brother (term 2)
    await m.merc.board(await reload(c.id), at(2)); // lazy completion awards
    expect(await heldTraitIds(c.id)).toEqual(["sellsword", "shield-brother"]);
    // A second settle finds no contract (already cleared) → no re-award, no error.
    const again = await m.dbPkg.settleMercContract(c.id, m.merc.contractCfgMap(), "complete", m.traits.getAllTraitDefs(), at(3));
    expect(again).toBeNull();
    expect(await heldTraitIds(c.id)).toEqual(["sellsword", "shield-brother"]);
  });

  it("awards NOTHING on an early cancel", async () => {
    const c = await makeHoplite({ drachmae: 0 });
    await m.merc.takeContract(c, "trade-ship", at(0)); // minCancel 0
    const cancelled = await m.merc.cancelContract(await reload(c.id), at(0.5));
    expect(cancelled.ok).toBe(true);
    expect((await reload(c.id)).contractId).toBeNull();
    expect(await heldTraitIds(c.id)).toEqual([]); // no sellsword on early return
  });

  // --- Step 3: abroad pool routing + card resolution -------------------------

  it("routes the daily pool by contract (home → class pool; abroad → contract pool) and resolves abroad cards", async () => {
    const c = await makeHoplite({ militia: 25, prestige: 20, drachmae: 0 });
    // Home: the source pool is the home class pool; abroad pools are hidden.
    expect(m.routines.activePoolKey(await reload(c.id))).toBe("citizen");

    await m.merc.takeContract(c, "syracuse", at(0));
    const abroad = await reload(c.id);
    // Abroad: the source pool swaps to the contract's poolKey (10 cards, all that pool).
    expect(m.routines.activePoolKey(abroad)).toBe("merc-syracuse");
    const cards = m.routines.activePoolCards(abroad);
    expect(cards.length).toBe(10);
    expect(cards.every((card) => card.pool === "merc-syracuse")).toBe(true);

    // A HOME card cannot be picked while abroad (validated against the active pool).
    const homeReject = await m.routines.resolveRoutine(abroad, "routine-rest", at(0.1));
    expect(homeReject.ok).toBe(false);

    // Picking an abroad card resolves its effects through the existing handler:
    // merc-sy-muster = +1 militia, +4 drachmae.
    const before = await reload(c.id);
    const res = await m.routines.resolveRoutine(before, "merc-sy-muster", at(0.1));
    expect(res.ok).toBe(true);
    const after = await reload(c.id);
    expect(after.militia).toBe(before.militia + 1);
    expect(after.drachmae).toBe(before.drachmae + 4);
  });

  it("resolves an abroad card's change_party_favor (the new routine effect type)", async () => {
    const c = await makeHoplite({ drachmae: 0 });
    await m.merc.takeContract(c, "trade-ship", at(0));
    // merc-ts-mercy grants +1 palaioi favor (a change_party_favor effect).
    const res = await m.routines.resolveRoutine(await reload(c.id), "merc-ts-mercy", at(0.1));
    expect(res.ok).toBe(true);
    const favor = await db
      .select({ favor: m.dbPkg.partyFavor.favor })
      .from(m.dbPkg.partyFavor)
      .where(and(eq(m.dbPkg.partyFavor.characterId, c.id), eq(m.dbPkg.partyFavor.party, "palaioi")))
      .limit(1);
    expect(favor[0]?.favor).toBe(1);
  });
});
