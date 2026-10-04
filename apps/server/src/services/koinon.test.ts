import { describe, expect, it, beforeAll, beforeEach } from "vitest";
import { and, asc, eq, sql } from "drizzle-orm";

// ---------------------------------------------------------------------------
// The koinon (koinon prompt 1) — integration tests against a REAL Postgres,
// guarded to a *_test database (mirrors market.test.ts). Founding, invites,
// accepting (and two races for it), leaving and the lead, expulsion, the vice,
// the absent leader, deleted accounts, the board, the pending count, and the
// leader's read-only view of the members' soldiers.
// ---------------------------------------------------------------------------

const dbUrl = process.env.DATABASE_URL ?? "";
const suite = describe.runIf(dbUrl.includes("_test"));

const HOUR = 3_600_000;
const DAY = 86_400_000;
const T0 = Date.UTC(2000, 0, 1);
const NOW = new Date(T0 + 10 * DAY);
const at = (ms: number) => new Date(NOW.getTime() + ms);
const RACE_RUNS = 10;

async function loadModules() {
  const dbPkg = await import("@massalia/db");
  const buildings = await import("./buildings.js");
  const barracks = await import("./barracks.js");
  const mapGraph = await import("./mapGraph.js");
  const koinon = await import("./koinon.js");
  const age = await import("./age.js");
  return { dbPkg, buildings, barracks, mapGraph, koinon, age };
}
type Mods = Awaited<ReturnType<typeof loadModules>>;

suite("Koinon (integration)", () => {
  let m: Mods;
  let db: ReturnType<Mods["dbPkg"]["createDb"]>;
  let worldId: string;

  type PlayerOpts = { classId?: string; prestige?: number; drachmae?: number };
  async function freshPlayer(name: string, opts: PlayerOpts = {}) {
    const { users, players, playerCharacters } = m.dbPkg;
    const user = (await db.insert(users).values({ email: `u-${Math.random().toString(36).slice(2)}@t`, passwordHash: "x" }).returning())[0]!;
    const player = (await db.insert(players).values({ worldId, userId: user.id, name, color: "#123456", houseSlug: "test-house" }).returning())[0]!;
    await db.insert(playerCharacters).values({
      playerId: player.id,
      worldId,
      houseSlug: "test-house",
      classId: opts.classId ?? "trader",
      prestige: opts.prestige ?? 20,
      drachmae: opts.drachmae ?? 100,
      startAge: 30,
      deathAge: 90,
      avatarId: "avatar-30-1",
    });
    return player.id;
  }

  const ctx = async (playerId: string) => (await m.buildings.buildingContext(playerId, worldId))!;
  const characterId = async (playerId: string) =>
    (await db.select({ id: m.dbPkg.playerCharacters.id }).from(m.dbPkg.playerCharacters).where(eq(m.dbPkg.playerCharacters.playerId, playerId)).limit(1))[0]!.id;
  async function wallet(playerId: string) {
    return (await db.select({ drachmae: m.dbPkg.playerCharacters.drachmae }).from(m.dbPkg.playerCharacters).where(eq(m.dbPkg.playerCharacters.playerId, playerId)).limit(1))[0]!.drachmae;
  }
  async function treasury() {
    return (await db.select().from(m.dbPkg.worldTreasury).where(eq(m.dbPkg.worldTreasury.worldId, worldId)).limit(1))[0]?.balance ?? 0;
  }
  const koinonRow = async (id: string) => (await db.select().from(m.dbPkg.koina).where(eq(m.dbPkg.koina.id, id)).limit(1))[0]!;
  const memberIds = async (koinonId: string) =>
    (await db.select({ playerId: m.dbPkg.koinonMembers.playerId }).from(m.dbPkg.koinonMembers).where(eq(m.dbPkg.koinonMembers.koinonId, koinonId)).orderBy(asc(m.dbPkg.koinonMembers.joinedAt))).map((r) => r.playerId);
  const membershipsOf = async (playerId: string) => (await db.select().from(m.dbPkg.koinonMembers).where(eq(m.dbPkg.koinonMembers.playerId, playerId))).length;
  const invitesOf = async (playerId: string) => db.select().from(m.dbPkg.koinonInvites).where(eq(m.dbPkg.koinonInvites.playerId, playerId));
  const cooldownOf = async (playerId: string) => (await db.select({ until: m.dbPkg.players.koinonCooldownUntil }).from(m.dbPkg.players).where(eq(m.dbPkg.players.id, playerId)).limit(1))[0]!.until;
  // The koinon Chronicle lines a player's character holds, oldest first.
  async function lines(playerId: string) {
    const { effectLog } = m.dbPkg;
    const rows = await db.select().from(effectLog).where(and(eq(effectLog.characterId, await characterId(playerId)), eq(effectLog.kind, "koinon"))).orderBy(asc(effectLog.createdAt), asc(effectLog.id));
    return rows.map((r) => (r.detail as { chronicle: { event: string; koinonName: string } }).chronicle);
  }

  // Found through the service; the founder needs prestige 20 and 50 drachmae.
  async function found(playerId: string, name: string, now = NOW) {
    const res = await m.koinon.foundKoinon(await ctx(playerId), name, now);
    if (!res.ok) throw new Error(`found failed: ${res.error}`);
    return res.koinonId;
  }
  // Seat a member directly (the invite rules have their own tests).
  async function seat(koinonId: string, playerId: string, joinedAt = NOW) {
    await db.insert(m.dbPkg.koinonMembers).values({ worldId, playerId, koinonId, joinedAt, lastReadAt: joinedAt });
  }
  // Write an invite directly, bypassing the invite rule.
  async function writeInvite(koinonId: string, playerId: string, inviterId: string, expiresAt = at(48 * HOUR), createdAt = NOW) {
    return (await db.insert(m.dbPkg.koinonInvites).values({ worldId, koinonId, playerId, inviterPlayerId: inviterId, createdAt, expiresAt }).returning())[0]!.id;
  }
  const setVice = (koinonId: string, playerId: string | null) => db.update(m.dbPkg.koina).set({ vicePlayerId: playerId }).where(eq(m.dbPkg.koina.id, koinonId));
  const setCooldown = (playerId: string, until: Date | null) => db.update(m.dbPkg.players).set({ koinonCooldownUntil: until }).where(eq(m.dbPkg.players.id, playerId));
  async function dealtHand(playerId: string, createdAt: Date) {
    await db.insert(m.dbPkg.dailyDecisions).values({ characterId: await characterId(playerId), utcDay: createdAt.toISOString().slice(0, 10), arena: "court", eventId: "test-event", createdAt });
  }

  beforeAll(async () => {
    m = await loadModules();
    db = m.dbPkg.createDb();
    await m.buildings.loadBuildingsContent();
    await m.buildings.loadPopsContent();
    await m.age.loadAgeConfig();
    await m.barracks.loadBarracksContent();
    await m.mapGraph.loadMapGraph();
    await m.koinon.loadKoinonContent();
  });

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE koinon_posts, koinon_invites, koinon_members, koina, daily_decisions, player_units, player_levy, world_treasury, resources, effect_log, player_characters, dynasties, players, sessions, users, worlds CASCADE`);
    await db.insert(m.dbPkg.houses).values({ slug: "test-house", name: "House Test", initial: "T", alignment: "c", stance: "s", motto: "m", patron: "p", crest: "c" }).onConflictDoNothing();
    const world = (await db.insert(m.dbPkg.worlds).values({ name: "Koinon Test", seed: "ktest", startedAt: new Date(T0), endsAt: new Date(T0 + 182 * DAY), status: "active" }).returning())[0]!;
    worldId = world.id;
  });

  // --- found ------------------------------------------------------------------

  it("found is refused for a slave, at prestige 19, with 49 drachmae, under cooldown and in a koinon", async () => {
    const slave = await freshPlayer("Doulos", { classId: "slave" });
    expect(await m.koinon.foundKoinon(await ctx(slave), "The Chained", NOW)).toMatchObject({ ok: false, code: 403 });

    const lowly = await freshPlayer("Mikros", { prestige: 19 });
    expect(await m.koinon.foundKoinon(await ctx(lowly), "The Lowly", NOW)).toEqual({ ok: false, code: 403, error: "Founding a koinon needs prestige 20." });

    const poor = await freshPlayer("Penes", { drachmae: 49 });
    expect(await m.koinon.foundKoinon(await ctx(poor), "The Poor", NOW)).toEqual({ ok: false, code: 402, error: "You need 50 drachmae to found a koinon." });
    expect(await wallet(poor)).toBe(49);

    const cooling = await freshPlayer("Psychros");
    await setCooldown(cooling, at(HOUR));
    expect(await m.koinon.foundKoinon(await ctx(cooling), "The Cold", NOW)).toMatchObject({ ok: false, code: 409, error: "You left a koinon too recently. You may found another in 1h 0m." });
    // A cooldown that has run out no longer holds him.
    expect(await m.koinon.foundKoinon(await ctx(cooling), "The Cold", at(HOUR))).toMatchObject({ ok: true });

    expect(await m.koinon.foundKoinon(await ctx(cooling), "The Second", at(2 * HOUR))).toEqual({ ok: false, code: 409, error: "You are already in a koinon." });
    expect((await db.select().from(m.dbPkg.koina)).length).toBe(1);
    expect(await treasury()).toBe(50);
  });

  it("found is refused for a bad name and for a taken name in another case", async () => {
    const a = await freshPlayer("Kallias");
    const b = await freshPlayer("Deon");
    for (const bad of ["ab", "a".repeat(33), "12345", 7]) {
      expect(await m.koinon.foundKoinon(await ctx(a), bad, NOW)).toMatchObject({ ok: false, code: 400 });
    }
    await found(a, "The Sacred Band");
    expect(await m.koinon.foundKoinon(await ctx(b), "the SACRED band", NOW)).toEqual({ ok: false, code: 409, error: "A koinon already bears that name." });
    expect(await wallet(b)).toBe(100);
  });

  it("found debits 50, credits the treasury, seats the founder as leader and writes the line", async () => {
    const a = await freshPlayer("Kallias");
    const stale = await freshPlayer("Deon");
    const other = await found(stale, "The Elders");
    await writeInvite(other, a, stale);

    const res = await m.koinon.foundKoinon(await ctx(a), "  The  Sacred Band ", NOW);
    expect(res).toMatchObject({ ok: true, name: "The Sacred Band", wallet: 50 });
    if (!res.ok) return;
    expect(await wallet(a)).toBe(50);
    expect(await treasury()).toBe(100);
    expect(await koinonRow(res.koinonId)).toMatchObject({ worldId, name: "The Sacred Band", leaderPlayerId: a, vicePlayerId: null, dissolvedAt: null });
    expect(await memberIds(res.koinonId)).toEqual([a]);
    expect(await invitesOf(a)).toEqual([]);
    expect(await lines(a)).toEqual([{ event: "founded", koinonName: "The Sacred Band" }]);

    const view = await m.koinon.koinonView(await ctx(a), NOW);
    expect(view.me).toMatchObject({ role: "leader", prestige: 20, drachmae: 50 });
    expect(view.koinon).toMatchObject({ name: "The Sacred Band", leaderPlayerId: a, members: [{ playerId: a, name: "Kallias", role: "leader", houseName: expect.any(String) }] });
    expect(view.koina.map((k) => [k.name, k.leaderName, k.members, k.cap])).toEqual([["The Elders", "Deon", 1, 8], ["The Sacred Band", "Kallias", 1, 8]]);
    expect(view.rules).toEqual({ foundCost: 50, foundPrestige: 20, memberCap: 8, nameMin: 3, nameMax: 32, postMaxChars: 300, cooldownHours: 24, absentLeaderDays: 5, depositMax: 10000 });
  });

  // --- invite -----------------------------------------------------------------

  it("the leader and the vice invite; a member gets 403", async () => {
    const leader = await freshPlayer("Kallias");
    const vice = await freshPlayer("Deon");
    const member = await freshPlayer("Nikias");
    const k = await found(leader, "The Sacred Band");
    await seat(k, vice);
    await seat(k, member);
    await setVice(k, vice);
    await freshPlayer("Xenon");
    await freshPlayer("Lykos");
    await freshPlayer("Timon");

    const byLeader = await m.koinon.invite(await ctx(leader), "xenon", NOW);
    expect(byLeader).toMatchObject({ ok: true, invite: { playerName: "Xenon", expiresAt: at(48 * HOUR).toISOString() } });
    expect(await m.koinon.invite(await ctx(vice), "LYKOS", at(1000))).toMatchObject({ ok: true });
    expect(await m.koinon.invite(await ctx(member), "Timon", NOW)).toEqual({ ok: false, code: 403, error: "Only the leader and the vice may invite." });

    // The pending list is for the leader and the vice only.
    expect((await m.koinon.koinonView(await ctx(leader), NOW)).koinon!.pending.map((p) => p.playerName)).toEqual(["Xenon", "Lykos"]);
    expect((await m.koinon.koinonView(await ctx(member), NOW)).koinon!.pending).toEqual([]);

    // The vice withdraws the leader's invite; a member cannot.
    if (!byLeader.ok) return;
    expect(await m.koinon.withdrawInvite(await ctx(member), byLeader.invite.id, NOW)).toMatchObject({ ok: false, code: 403 });
    expect(await m.koinon.withdrawInvite(await ctx(vice), byLeader.invite.id, NOW)).toEqual({ ok: true });
    expect(await m.koinon.withdrawInvite(await ctx(vice), byLeader.invite.id, NOW)).toMatchObject({ ok: false, code: 404 });
  });

  it("invite refuses an unknown name, a slave, a member of another koinon and a duplicate", async () => {
    const leader = await freshPlayer("Kallias");
    const rival = await freshPlayer("Deon");
    const k = await found(leader, "The Sacred Band");
    await found(rival, "The Elders");
    await freshPlayer("Doulos", { classId: "slave" });
    await freshPlayer("Xenon");
    const c = await ctx(leader);

    expect(await m.koinon.invite(c, "Nobody", NOW)).toEqual({ ok: false, code: 404, error: "No citizen bears that name." });
    expect(await m.koinon.invite(c, "  ", NOW)).toMatchObject({ ok: false, code: 400 });
    expect(await m.koinon.invite(c, "Doulos", NOW)).toMatchObject({ ok: false, code: 409, error: "The unfree cannot join a koinon." });
    expect(await m.koinon.invite(c, "Deon", NOW)).toMatchObject({ ok: false, code: 409, error: "That citizen is already in a koinon." });
    expect(await m.koinon.invite(c, "Kallias", NOW)).toMatchObject({ ok: false, code: 409 });
    expect(await m.koinon.invite(c, "Xenon", NOW)).toMatchObject({ ok: true });
    expect(await m.koinon.invite(c, "Xenon", NOW)).toEqual({ ok: false, code: 409, error: "That citizen already holds your invitation." });
    expect((await db.select().from(m.dbPkg.koinonInvites).where(eq(m.dbPkg.koinonInvites.koinonId, k))).length).toBe(1);
  });

  it("with 6 members and 2 pending invites a third invite is 409, and an expired invite does not block", async () => {
    const leader = await freshPlayer("Kallias");
    const k = await found(leader, "The Sacred Band");
    for (let i = 0; i < 5; i++) await seat(k, await freshPlayer(`Member${i}`));
    const c = await ctx(leader);
    const xenon = await freshPlayer("Xenon");
    await freshPlayer("Lykos");
    await freshPlayer("Timon");

    expect(await m.koinon.invite(c, "Xenon", NOW)).toMatchObject({ ok: true });
    expect(await m.koinon.invite(c, "Lykos", NOW)).toMatchObject({ ok: true });
    expect(await m.koinon.invite(c, "Timon", NOW)).toMatchObject({ ok: false, code: 409, error: "The koinon is full: its members and standing invitations already number 8." });

    // 48 hours on, both invites have expired: they count for nothing, and the
    // expired row for Xenon does not block inviting him again.
    const later = at(48 * HOUR);
    expect(await m.koinon.invite(c, "Timon", later)).toMatchObject({ ok: true });
    expect(await m.koinon.invite(c, "Xenon", later)).toMatchObject({ ok: true });
    const mine = await invitesOf(xenon);
    expect(mine.length).toBe(1);
    expect(mine[0]!.expiresAt.getTime()).toBe(later.getTime() + 48 * HOUR);
  });

  // --- accept -----------------------------------------------------------------

  it("accept is refused when expired, under cooldown, or full", async () => {
    const leader = await freshPlayer("Kallias");
    const k = await found(leader, "The Sacred Band");
    const xenon = await freshPlayer("Xenon");

    const expired = await writeInvite(k, xenon, leader, NOW);
    expect(await m.koinon.acceptInvite(await ctx(xenon), expired, NOW)).toEqual({ ok: false, code: 409, error: "That invitation has expired." });
    await db.delete(m.dbPkg.koinonInvites);

    const inviteId = await writeInvite(k, xenon, leader);
    await setCooldown(xenon, at(90 * 60_000));
    expect(await m.koinon.acceptInvite(await ctx(xenon), inviteId, NOW)).toEqual({ ok: false, code: 409, error: "You left a koinon too recently. You may join another in 1h 30m." });
    await setCooldown(xenon, null);

    for (let i = 0; i < 7; i++) await seat(k, await freshPlayer(`Member${i}`));
    expect(await m.koinon.acceptInvite(await ctx(xenon), inviteId, NOW)).toEqual({ ok: false, code: 409, error: "That koinon is full." });
    expect(await membershipsOf(xenon)).toBe(0);
    // A refusal leaves the invite standing; someone else's invite is not his to take.
    expect((await invitesOf(xenon)).length).toBe(1);
    expect(await m.koinon.acceptInvite(await ctx(leader), inviteId, NOW)).toMatchObject({ ok: false, code: 404 });
  });

  it("accept seats the player, writes the line and deletes his other invites", async () => {
    const leader = await freshPlayer("Kallias");
    const rival = await freshPlayer("Deon");
    const k = await found(leader, "The Sacred Band");
    const other = await found(rival, "The Elders");
    const xenon = await freshPlayer("Xenon");
    const inviteId = await writeInvite(k, xenon, leader);
    const otherId = await writeInvite(other, xenon, rival, at(48 * HOUR), at(1000));

    const before = await m.koinon.koinonView(await ctx(xenon), NOW);
    expect(before.koinon).toBeNull();
    expect(before.invites.map((i) => [i.koinonName, i.inviterName])).toEqual([["The Sacred Band", "Kallias"], ["The Elders", "Deon"]]);
    expect(await m.koinon.koinonPendingCount(xenon, worldId, NOW)).toBe(2);

    expect(await m.koinon.acceptInvite(await ctx(xenon), inviteId, at(HOUR))).toEqual({ ok: true, koinonId: k, name: "The Sacred Band" });
    expect(await memberIds(k)).toEqual([leader, xenon]);
    expect(await invitesOf(xenon)).toEqual([]);
    expect(await lines(xenon)).toEqual([{ event: "joined", koinonName: "The Sacred Band" }]);
    expect(await m.koinon.acceptInvite(await ctx(xenon), otherId, at(HOUR))).toMatchObject({ ok: false, code: 404 });

    const after = await m.koinon.koinonView(await ctx(xenon), at(HOUR));
    expect(after.me.role).toBe("member");
    expect(after.invites).toEqual([]);
    expect(after.koinon!.members.map((x) => [x.name, x.role])).toEqual([["Kallias", "leader"], ["Xenon", "member"]]);
    // Declining is the invitee's; the invite is gone afterwards.
    const timon = await freshPlayer("Timon");
    const declined = await writeInvite(k, timon, leader);
    expect(await m.koinon.declineInvite(await ctx(xenon), declined)).toMatchObject({ ok: false, code: 404 });
    expect(await m.koinon.declineInvite(await ctx(timon), declined)).toEqual({ ok: true });
    expect(await invitesOf(timon)).toEqual([]);
  });

  it(`two players racing for the last seat: exactly one is seated, ${RACE_RUNS} runs`, async () => {
    for (let run = 0; run < RACE_RUNS; run++) {
      const leader = await freshPlayer(`Leader${run}`);
      const k = await found(leader, `Band ${run}`);
      for (let i = 0; i < 6; i++) await seat(k, await freshPlayer(`Member${run}-${i}`));
      const a = await freshPlayer(`RacerA${run}`);
      const b = await freshPlayer(`RacerB${run}`);
      // Two invites for one seat, written directly: the invite rule would refuse the second.
      const inviteA = await writeInvite(k, a, leader);
      const inviteB = await writeInvite(k, b, leader);

      const results = await Promise.all([m.koinon.acceptInvite(await ctx(a), inviteA, NOW), m.koinon.acceptInvite(await ctx(b), inviteB, NOW)]);
      expect(results.filter((r) => r.ok).length).toBe(1);
      expect(results.find((r) => !r.ok)).toEqual({ ok: false, code: 409, error: "That koinon is full." });
      expect((await memberIds(k)).length).toBe(8);
    }
  });

  it(`one player accepting two koina at once holds exactly one membership, ${RACE_RUNS} runs`, async () => {
    for (let run = 0; run < RACE_RUNS; run++) {
      const one = await freshPlayer(`One${run}`);
      const two = await freshPlayer(`Two${run}`);
      const k1 = await found(one, `First ${run}`);
      const k2 = await found(two, `Second ${run}`);
      const racer = await freshPlayer(`Racer${run}`);
      const i1 = await writeInvite(k1, racer, one);
      const i2 = await writeInvite(k2, racer, two);

      const results = await Promise.all([m.koinon.acceptInvite(await ctx(racer), i1, NOW), m.koinon.acceptInvite(await ctx(racer), i2, NOW)]);
      expect(results.filter((r) => r.ok).length).toBe(1);
      expect(await membershipsOf(racer)).toBe(1);
      expect(await invitesOf(racer)).toEqual([]);
      expect((await lines(racer)).length).toBe(1);
    }
  });

  // --- leave and the lead -------------------------------------------------------

  it("a member leaving gets the cooldown and the line; the koinon is unchanged", async () => {
    const leader = await freshPlayer("Kallias");
    const member = await freshPlayer("Nikias");
    const k = await found(leader, "The Sacred Band");
    await seat(k, member);

    const res = await m.koinon.leave(await ctx(member), NOW);
    expect(res).toEqual({ ok: true, dissolved: false, cooldownUntil: at(24 * HOUR).toISOString() });
    expect((await cooldownOf(member))!.getTime()).toBe(at(24 * HOUR).getTime());
    expect(await memberIds(k)).toEqual([leader]);
    expect(await koinonRow(k)).toMatchObject({ leaderPlayerId: leader, dissolvedAt: null });
    expect(await lines(member)).toEqual([{ event: "left", koinonName: "The Sacred Band" }]);
    expect(await m.koinon.leave(await ctx(member), NOW)).toEqual({ ok: false, code: 403, error: "You are not in a koinon." });
    // Under cooldown he can neither found nor accept.
    expect(await m.koinon.foundKoinon(await ctx(member), "The Leavers", at(HOUR))).toMatchObject({ ok: false, code: 409 });
  });

  it("the leader leaving hands the lead to the vice; with no vice, to the longest-standing member", async () => {
    const leader = await freshPlayer("Kallias");
    const early = await freshPlayer("Nikias");
    const vice = await freshPlayer("Deon");
    const k = await found(leader, "The Sacred Band");
    await seat(k, early, at(HOUR));
    await seat(k, vice, at(2 * HOUR));
    await setVice(k, vice);

    const t1 = at(3 * HOUR);
    expect(await m.koinon.leave(await ctx(leader), t1)).toMatchObject({ ok: true, dissolved: false });
    const afterVice = await koinonRow(k);
    expect(afterVice).toMatchObject({ leaderPlayerId: vice, vicePlayerId: null });
    expect(afterVice.leaderSince.getTime()).toBe(t1.getTime());
    expect(await lines(vice)).toEqual([{ event: "leader", koinonName: "The Sacred Band" }]);
    expect(await lines(leader)).toEqual([{ event: "founded", koinonName: "The Sacred Band" }, { event: "left", koinonName: "The Sacred Band" }]);

    // No vice now: the lead goes to the earliest joined_at.
    const late = await freshPlayer("Xenon");
    await seat(k, late, at(4 * HOUR));
    const t2 = at(5 * HOUR);
    expect(await m.koinon.leave(await ctx(vice), t2)).toMatchObject({ ok: true, dissolved: false });
    expect(await koinonRow(k)).toMatchObject({ leaderPlayerId: early, vicePlayerId: null });
    expect(await lines(early)).toEqual([{ event: "leader", koinonName: "The Sacred Band" }]);
    expect(await lines(late)).toEqual([]);
  });

  it("the vice leaving empties the vice seat", async () => {
    const leader = await freshPlayer("Kallias");
    const vice = await freshPlayer("Deon");
    const k = await found(leader, "The Sacred Band");
    await seat(k, vice);
    await setVice(k, vice);
    expect(await m.koinon.leave(await ctx(vice), NOW)).toMatchObject({ ok: true });
    expect(await koinonRow(k)).toMatchObject({ leaderPlayerId: leader, vicePlayerId: null });
  });

  it("the last member leaving dissolves the koinon and frees the name", async () => {
    const leader = await freshPlayer("Kallias");
    const other = await freshPlayer("Deon");
    const xenon = await freshPlayer("Xenon");
    const k = await found(leader, "The Sacred Band");
    await writeInvite(k, xenon, leader);
    expect(await m.koinon.post(await ctx(leader), "Muster at dawn.", NOW)).toMatchObject({ ok: true });

    const t = at(HOUR);
    expect(await m.koinon.leave(await ctx(leader), t)).toMatchObject({ ok: true, dissolved: true });
    expect((await koinonRow(k)).dissolvedAt!.getTime()).toBe(t.getTime());
    expect(await memberIds(k)).toEqual([]);
    expect(await invitesOf(xenon)).toEqual([]);
    expect((await db.select().from(m.dbPkg.koinonPosts)).length).toBe(0);
    expect((await m.koinon.koinonView(await ctx(other), t)).koina).toEqual([]);

    // The name is free again, in any case.
    expect(await m.koinon.foundKoinon(await ctx(other), "the sacred band", t)).toMatchObject({ ok: true });
  });

  // --- expel --------------------------------------------------------------------

  it("expel is the leader's; he cannot expel himself; the expelled gets the cooldown and the line", async () => {
    const leader = await freshPlayer("Kallias");
    const vice = await freshPlayer("Deon");
    const member = await freshPlayer("Nikias");
    const outsider = await freshPlayer("Xenon");
    const k = await found(leader, "The Sacred Band");
    await seat(k, vice);
    await seat(k, member);
    await setVice(k, vice);

    expect(await m.koinon.expel(await ctx(vice), member, NOW)).toEqual({ ok: false, code: 403, error: "Only the leader may expel." });
    expect(await m.koinon.expel(await ctx(member), vice, NOW)).toMatchObject({ ok: false, code: 403 });
    expect(await m.koinon.expel(await ctx(leader), leader, NOW)).toEqual({ ok: false, code: 409, error: "The leader cannot expel himself." });
    expect(await m.koinon.expel(await ctx(leader), outsider, NOW)).toMatchObject({ ok: false, code: 404 });

    expect(await m.koinon.expel(await ctx(leader), vice, NOW)).toEqual({ ok: true });
    expect(await memberIds(k)).toEqual([leader, member]);
    expect(await koinonRow(k)).toMatchObject({ leaderPlayerId: leader, vicePlayerId: null });
    expect((await cooldownOf(vice))!.getTime()).toBe(at(24 * HOUR).getTime());
    expect(await lines(vice)).toEqual([{ event: "expelled", koinonName: "The Sacred Band" }]);
    expect(await cooldownOf(leader)).toBeNull();
  });

  // --- vice and hand over -------------------------------------------------------

  it("the vice is set and cleared by the leader only, from the members", async () => {
    const leader = await freshPlayer("Kallias");
    const member = await freshPlayer("Nikias");
    const outsider = await freshPlayer("Xenon");
    const k = await found(leader, "The Sacred Band");
    await seat(k, member);

    expect(await m.koinon.setVice(await ctx(member), member, NOW)).toMatchObject({ ok: false, code: 403 });
    expect(await m.koinon.setVice(await ctx(leader), leader, NOW)).toMatchObject({ ok: false, code: 409 });
    expect(await m.koinon.setVice(await ctx(leader), outsider, NOW)).toMatchObject({ ok: false, code: 404 });
    expect(await m.koinon.setVice(await ctx(leader), member, NOW)).toEqual({ ok: true });
    expect((await koinonRow(k)).vicePlayerId).toBe(member);
    expect((await m.koinon.koinonView(await ctx(member), NOW)).me.role).toBe("vice");
    expect(await m.koinon.setVice(await ctx(leader), null, NOW)).toEqual({ ok: true });
    expect((await koinonRow(k)).vicePlayerId).toBeNull();
  });

  it("hand over makes the vice the leader, empties the vice seat and resets leader_since", async () => {
    const leader = await freshPlayer("Kallias");
    const vice = await freshPlayer("Deon");
    const k = await found(leader, "The Sacred Band");
    await seat(k, vice);
    await setVice(k, vice);

    expect(await m.koinon.handOver(await ctx(vice), leader, NOW)).toMatchObject({ ok: false, code: 403 });
    expect(await m.koinon.handOver(await ctx(leader), leader, NOW)).toMatchObject({ ok: false, code: 409 });
    const t = at(3 * HOUR);
    expect(await m.koinon.handOver(await ctx(leader), vice, t)).toEqual({ ok: true });
    const row = await koinonRow(k);
    expect(row).toMatchObject({ leaderPlayerId: vice, vicePlayerId: null });
    expect(row.leaderSince.getTime()).toBe(t.getTime());
    // The old leader stays on as a member, with no cooldown.
    expect(await memberIds(k)).toEqual([leader, vice]);
    expect(await cooldownOf(leader)).toBeNull();
    expect(await lines(vice)).toEqual([{ event: "leader", koinonName: "The Sacred Band" }]);
  });

  // --- take the lead ------------------------------------------------------------

  it("the vice takes the lead at 5 days of absence, not at 4", async () => {
    const leader = await freshPlayer("Kallias");
    const vice = await freshPlayer("Deon");
    const k = await found(leader, "The Sacred Band", at(-30 * DAY));
    await seat(k, vice, at(-29 * DAY));
    await setVice(k, vice);

    await dealtHand(leader, at(-4 * DAY));
    expect((await m.koinon.koinonView(await ctx(vice), NOW)).koinon).toMatchObject({ leaderAbsent: false, canTakeLead: false });
    expect(await m.koinon.takeLead(await ctx(vice), NOW)).toEqual({ ok: false, code: 409, error: "The leader has been seen too recently." });

    // A day on, that same hand is 5 days old.
    const t = at(DAY);
    expect((await m.koinon.koinonView(await ctx(vice), t)).koinon).toMatchObject({ leaderAbsent: true, canTakeLead: true });
    expect((await m.koinon.koinonView(await ctx(leader), t)).koinon).toMatchObject({ leaderAbsent: true, canTakeLead: false });
    expect(await m.koinon.takeLead(await ctx(leader), t)).toMatchObject({ ok: false, code: 403 });
    expect(await m.koinon.takeLead(await ctx(vice), t)).toEqual({ ok: true });
    const row = await koinonRow(k);
    expect(row).toMatchObject({ leaderPlayerId: vice, vicePlayerId: null });
    expect(row.leaderSince.getTime()).toBe(t.getTime());
    // The old leader stays as a member.
    expect(await memberIds(k)).toEqual([leader, vice]);
    expect(await lines(vice)).toEqual([{ event: "leader", koinonName: "The Sacred Band" }]);
  });

  it("with no vice the longest-standing member takes the lead; another member gets 403", async () => {
    const leader = await freshPlayer("Kallias");
    const early = await freshPlayer("Nikias");
    const late = await freshPlayer("Xenon");
    const k = await found(leader, "The Sacred Band", at(-30 * DAY));
    await seat(k, early, at(-20 * DAY));
    await seat(k, late, at(-10 * DAY));
    await dealtHand(leader, at(-6 * DAY));

    expect((await m.koinon.koinonView(await ctx(late), NOW)).koinon).toMatchObject({ leaderAbsent: true, canTakeLead: false });
    expect(await m.koinon.takeLead(await ctx(late), NOW)).toEqual({ ok: false, code: 403, error: "The lead is not yours to take." });
    expect((await m.koinon.koinonView(await ctx(early), NOW)).koinon).toMatchObject({ canTakeLead: true });
    expect(await m.koinon.takeLead(await ctx(early), NOW)).toEqual({ ok: true });
    expect(await koinonRow(k)).toMatchObject({ leaderPlayerId: early, vicePlayerId: null });
  });

  it("a leader of 2 days whose character has no daily rows is not absent", async () => {
    const leader = await freshPlayer("Kallias");
    const vice = await freshPlayer("Deon");
    const k = await found(leader, "The Sacred Band", at(-2 * DAY));
    await seat(k, vice, at(-2 * DAY));
    await setVice(k, vice);

    expect((await m.koinon.koinonView(await ctx(vice), NOW)).koinon).toMatchObject({ leaderAbsent: false, canTakeLead: false });
    expect(await m.koinon.takeLead(await ctx(vice), NOW)).toMatchObject({ ok: false, code: 409 });
    // Five days in the lead with no hand ever dealt: absent.
    expect(await m.koinon.takeLead(await ctx(vice), at(3 * DAY))).toEqual({ ok: true });
  });

  // --- deleted account ----------------------------------------------------------

  it("a member whose account is deleted is gone from the next view, with no cooldown and no line", async () => {
    const leader = await freshPlayer("Kallias");
    const member = await freshPlayer("Nikias");
    const k = await found(leader, "The Sacred Band");
    await seat(k, member);
    await db.update(m.dbPkg.players).set({ isActive: false }).where(eq(m.dbPkg.players.id, member));

    const view = await m.koinon.koinonView(await ctx(leader), NOW);
    expect(view.koinon!.members.map((x) => x.name)).toEqual(["Kallias"]);
    expect(view.koina).toMatchObject([{ name: "The Sacred Band", members: 1 }]);
    expect(await memberIds(k)).toEqual([leader]);
    expect(await cooldownOf(member)).toBeNull();
    expect(await lines(member)).toEqual([]);
  });

  it("when the deleted account was the leader the lead has passed; a koinon left empty is dissolved", async () => {
    const leader = await freshPlayer("Kallias");
    const vice = await freshPlayer("Deon");
    const k = await found(leader, "The Sacred Band");
    await seat(k, vice);
    await setVice(k, vice);
    await db.update(m.dbPkg.players).set({ isActive: false }).where(eq(m.dbPkg.players.id, leader));

    const view = await m.koinon.koinonView(await ctx(vice), at(HOUR));
    expect(view.me.role).toBe("leader");
    expect(view.koinon).toMatchObject({ leaderPlayerId: vice, vicePlayerId: null });
    expect(view.koinon!.members.map((x) => x.name)).toEqual(["Deon"]);
    expect(await lines(vice)).toEqual([{ event: "leader", koinonName: "The Sacred Band" }]);

    // The last member's account goes too: any player's next read dissolves it.
    const outsider = await freshPlayer("Xenon");
    await db.update(m.dbPkg.players).set({ isActive: false }).where(eq(m.dbPkg.players.id, vice));
    expect((await m.koinon.koinonView(await ctx(outsider), at(2 * HOUR))).koina).toEqual([]);
    expect((await koinonRow(k)).dissolvedAt).not.toBeNull();
  });

  // --- board --------------------------------------------------------------------

  it("the leader and the vice post; a member gets 403; 301 characters is 400", async () => {
    const leader = await freshPlayer("Kallias");
    const vice = await freshPlayer("Deon");
    const member = await freshPlayer("Nikias");
    const k = await found(leader, "The Sacred Band");
    await seat(k, vice);
    await seat(k, member);
    await setVice(k, vice);

    expect(await m.koinon.post(await ctx(member), "Hello.", NOW)).toEqual({ ok: false, code: 403, error: "Only the leader and the vice may post." });
    expect(await m.koinon.post(await ctx(leader), "a".repeat(301), NOW)).toEqual({ ok: false, code: 400, error: "A post runs 1 to 300 characters." });
    expect(await m.koinon.post(await ctx(leader), "\n\n", NOW)).toMatchObject({ ok: false, code: 400 });
    expect(await m.koinon.post(await ctx(leader), "Muster\nat dawn.", at(1000))).toMatchObject({ ok: true });
    expect(await m.koinon.post(await ctx(vice), "Bring spears.", at(2000))).toMatchObject({ ok: true });

    const view = await m.koinon.koinonView(await ctx(member), at(3000));
    expect(view.koinon!.posts.map((p) => [p.authorName, p.body, p.canDelete])).toEqual([["Deon", "Bring spears.", false], ["Kallias", "Muster at dawn.", false]]);
    expect(view.koinon!.posts[0]!.label).toMatch(/, \d+ BC$/);
    // The vice may delete his own, the leader any.
    expect((await m.koinon.koinonView(await ctx(vice), at(3000))).koinon!.posts.map((p) => p.canDelete)).toEqual([true, false]);
    expect((await m.koinon.koinonView(await ctx(leader), at(3000))).koinon!.posts.map((p) => p.canDelete)).toEqual([true, true]);
  });

  it("the 21st post deletes the oldest", async () => {
    const leader = await freshPlayer("Kallias");
    await found(leader, "The Sacred Band");
    for (let i = 1; i <= 21; i++) expect(await m.koinon.post(await ctx(leader), `Post ${i}`, at(i * 1000))).toMatchObject({ ok: true });
    const posts = (await m.koinon.koinonView(await ctx(leader), at(60_000))).koinon!.posts;
    expect(posts.length).toBe(20);
    expect(posts[0]!.body).toBe("Post 21");
    expect(posts[19]!.body).toBe("Post 2");
  });

  it("the author deletes his own post, the leader the vice's; the vice cannot delete the leader's", async () => {
    const leader = await freshPlayer("Kallias");
    const vice = await freshPlayer("Deon");
    const k = await found(leader, "The Sacred Band");
    await seat(k, vice);
    await setVice(k, vice);
    const byLeader = await m.koinon.post(await ctx(leader), "From the leader.", at(1000));
    const byVice1 = await m.koinon.post(await ctx(vice), "From the vice, one.", at(2000));
    const byVice2 = await m.koinon.post(await ctx(vice), "From the vice, two.", at(3000));
    if (!byLeader.ok || !byVice1.ok || !byVice2.ok) throw new Error("post failed");

    expect(await m.koinon.deletePost(await ctx(vice), byLeader.postId, NOW)).toEqual({ ok: false, code: 403, error: "That post is not yours to delete." });
    expect(await m.koinon.deletePost(await ctx(vice), byVice1.postId, NOW)).toEqual({ ok: true });
    expect(await m.koinon.deletePost(await ctx(leader), byVice2.postId, NOW)).toEqual({ ok: true });
    expect(await m.koinon.deletePost(await ctx(leader), byVice2.postId, NOW)).toMatchObject({ ok: false, code: 404 });
    expect((await m.koinon.koinonView(await ctx(leader), at(4000))).koinon!.posts.map((p) => p.body)).toEqual(["From the leader."]);
  });

  // --- pending count ------------------------------------------------------------

  it("a member's count is other players' posts after last_read_at; markRead zeroes it", async () => {
    const leader = await freshPlayer("Kallias");
    const member = await freshPlayer("Nikias");
    const k = await found(leader, "The Sacred Band");
    await seat(k, member);

    await m.koinon.post(await ctx(leader), "One.", at(1000));
    await m.koinon.post(await ctx(leader), "Two.", at(2000));
    expect(await m.koinon.koinonPendingCount(member, worldId, at(3000))).toBe(2);
    expect(await m.koinon.koinonPendingCount(leader, worldId, at(3000))).toBe(0); // his own posts
    expect((await m.koinon.koinonView(await ctx(member), at(3000))).koinon!.unread).toBe(2);

    expect(await m.koinon.markRead(await ctx(member), at(3000))).toEqual({ ok: true });
    expect(await m.koinon.koinonPendingCount(member, worldId, at(4000))).toBe(0);
    await m.koinon.post(await ctx(leader), "Three.", at(5000));
    expect(await m.koinon.koinonPendingCount(member, worldId, at(6000))).toBe(1);

    const outsider = await freshPlayer("Xenon");
    expect(await m.koinon.markRead(await ctx(outsider), NOW)).toMatchObject({ ok: false, code: 403 });
  });

  it("a non-member's count is his unexpired invites", async () => {
    const leader = await freshPlayer("Kallias");
    const rival = await freshPlayer("Deon");
    const k = await found(leader, "The Sacred Band");
    const other = await found(rival, "The Elders");
    const xenon = await freshPlayer("Xenon");
    expect(await m.koinon.koinonPendingCount(xenon, worldId, NOW)).toBe(0);
    await writeInvite(k, xenon, leader, at(48 * HOUR));
    await writeInvite(other, xenon, rival, at(HOUR));
    expect(await m.koinon.koinonPendingCount(xenon, worldId, NOW)).toBe(2);
    expect(await m.koinon.koinonPendingCount(xenon, worldId, at(HOUR))).toBe(1);
    expect((await m.koinon.koinonView(await ctx(xenon), at(HOUR))).invites.map((i) => i.koinonName)).toEqual(["The Sacred Band"]);
    expect(await m.koinon.koinonPendingCount(xenon, worldId, at(48 * HOUR))).toBe(0);
  });

  // --- armies -------------------------------------------------------------------

  it("armies: the leader sees every member's soldiers derived at read time, and no row changes", async () => {
    const { playerUnits, playerLevy, resources } = m.dbPkg;
    const leader = await freshPlayer("Kallias");
    const vice = await freshPlayer("Deon");
    const member = await freshPlayer("Nikias");
    const k = await found(leader, "The Sacred Band");
    await seat(k, vice, at(1000));
    await seat(k, member, at(2000));
    await setVice(k, vice);

    const massalia = m.mapGraph.getTopology().massaliaRegion;
    const elsewhere = [...m.mapGraph.getTopology().townRegion.values()].find((r) => r !== massalia)!;
    const bandId = Object.keys(m.barracks.getBandsContent().bands).sort()[0]!;
    const bandLabel = m.barracks.getBandsContent().bands[bandId]!.label;
    const unit = (over: Record<string, unknown>) => ({ worldId, ownerPlayerId: member, source: "trained" as const, unitId: "hoplite", count: 10, startCount: 10, recruitedSeason: 0, readyAt: at(-DAY), basedAt: massalia, ...over });
    await db.insert(playerUnits).values([
      // Home at Massalia, two trained rows of one unit: shown as one line.
      unit({ count: 10, createdAt: at(-9 * DAY) }),
      unit({ count: 5, startCount: 5, createdAt: at(-8 * DAY) }),
      // Past arrives_at: stands at its destination, at home.
      unit({ unitId: "peltast", count: 20, startCount: 20, movingTo: elsewhere, arrivesAt: at(-HOUR), mission: { kind: "move", regionId: elsewhere, departedAt: at(-2 * HOUR).toISOString() }, createdAt: at(-7 * DAY) }),
      // Still on the march, raiding.
      unit({ unitId: "ekdromos", count: 8, startCount: 8, movingTo: elsewhere, arrivesAt: at(2 * HOUR), mission: { kind: "raid", regionId: elsewhere, departedAt: at(-HOUR).toISOString() }, createdAt: at(-6 * DAY) }),
      // On the way back from that region.
      unit({ unitId: "hippeis", count: 4, startCount: 4, movingTo: massalia, arrivesAt: at(3 * HOUR), mission: { kind: "raid", regionId: elsewhere, departedAt: at(-HOUR).toISOString() }, createdAt: at(-5 * DAY) }),
      // Past ready_at: trained (at home). Short of it: in training.
      unit({ unitId: "peltast", count: 6, startCount: 6, readyAt: at(-1000), createdAt: at(-4 * DAY) }),
      unit({ unitId: "peltast", count: 7, startCount: 7, readyAt: at(5 * HOUR), createdAt: at(-3 * DAY) }),
      // A band in contract, and one whose contract has run out (left out).
      unit({ source: "band", unitId: bandId, count: 40, startCount: 40, readyAt: null, contractEndAt: at(DAY), createdAt: at(-2 * DAY) }),
      unit({ source: "band", unitId: bandId, count: 33, startCount: 40, readyAt: null, contractEndAt: at(-1000), createdAt: at(-1 * DAY) }),
    ]);
    // Season 10 at NOW: two whole years of base growth since season 0, and no more.
    await db.insert(playerLevy).values({ worldId, ownerPlayerId: member, men: 60, lastGrowthSeason: 0 });
    await db.insert(resources).values([
      { scope: "player", scopeId: member, type: "trade-ship", amount: "2.9", ratePerSecond: "0", lastUpdatedAt: NOW },
      { scope: "player", scopeId: member, type: "galley", amount: "1", ratePerSecond: "0", lastUpdatedAt: NOW },
    ]);

    const snapshot = async () => ({
      units: await db.select().from(playerUnits).orderBy(asc(playerUnits.id)),
      levy: await db.select().from(playerLevy).orderBy(asc(playerLevy.ownerPlayerId)),
      stock: await db.select().from(resources).orderBy(asc(resources.id)),
    });
    const before = await snapshot();

    expect(await m.koinon.memberArmies(await ctx(vice), NOW)).toEqual({ ok: false, code: 403, error: "Only the leader sees the soldiers." });
    expect(await m.koinon.memberArmies(await ctx(member), NOW)).toMatchObject({ ok: false, code: 403 });
    const view = await m.koinon.memberArmies(await ctx(leader), NOW);
    if ("error" in view) throw new Error(view.error);

    expect(view.members.map((x) => x.name)).toEqual(["Kallias", "Deon", "Nikias"]);
    const levy = m.barracks.getUnitsContent().levy;
    // No levy row yet: what ensureLevy would insert at season 10.
    expect(view.members[0]).toMatchObject({ levy: levy.startMen + 2 * levy.growthPerYear, fleet: { pentekonters: 0, triremes: 0 }, home: [], away: [], training: [] });

    const mine = view.members[2]!;
    expect(mine.levy).toBe(60 + 2 * levy.growthPerYear);
    expect(mine.fleet).toEqual({ pentekonters: 2, triremes: 1 });
    expect(mine.home.map((p) => p.placeId)).toEqual([massalia, elsewhere]);
    expect(mine.home[0]!.rows.map((r) => [r.source, r.unitId, r.count])).toEqual([["trained", "hoplite", 15], ["trained", "peltast", 6], ["band", bandId, 40]]);
    expect(mine.home[0]!.rows[0]).toMatchObject({ label: "Hoplite", plural: "Hoplites", icon: "HOPLITE.webp" });
    expect(mine.home[0]!.rows[2]).toMatchObject({ label: bandLabel, plural: bandLabel });
    expect(mine.home[1]!.rows.map((r) => [r.unitId, r.count])).toEqual([["peltast", 20]]);
    expect(mine.home[1]!.placeName).not.toBe("");
    expect(mine.away.map((r) => [r.unitId, r.count, r.missionKind, r.arrivesAt])).toEqual([
      ["ekdromos", 8, "raid", at(2 * HOUR).toISOString()],
      ["hippeis", 4, "return", at(3 * HOUR).toISOString()],
    ]);
    expect(mine.away[0]!.targetName).toBe(mine.home[1]!.placeName);
    expect(mine.training.map((r) => [r.unitId, r.count, r.readyAt])).toEqual([["peltast", 7, at(5 * HOUR).toISOString()]]);

    // Read-only: no row of player_units, player_levy or resources changed.
    expect(await snapshot()).toEqual(before);
  });

  it("deriveArmyRow: each state from the row's own timers", () => {
    const base = { source: "trained" as const, unitId: "hoplite", count: 10, readyAt: at(-DAY), contractEndAt: null, basedAt: "R001", movingTo: null, arrivesAt: null, mission: null };
    const derive = m.koinon.deriveArmyRow;
    expect(derive(base, NOW)).toEqual({ state: "home", placeId: "R001" });
    expect(derive({ ...base, readyAt: NOW }, NOW)).toEqual({ state: "home", placeId: "R001" });
    expect(derive({ ...base, readyAt: at(1) }, NOW)).toEqual({ state: "training", readyAt: at(1) });
    expect(derive({ ...base, movingTo: "R002", arrivesAt: at(1) }, NOW)).toEqual({ state: "away", movingTo: "R002", arrivesAt: at(1) });
    expect(derive({ ...base, movingTo: "R002", arrivesAt: NOW }, NOW)).toEqual({ state: "home", placeId: "R002" });
    expect(derive({ ...base, count: 0 }, NOW)).toEqual({ state: "gone" });
    const band = { ...base, source: "band" as const, readyAt: null, contractEndAt: at(1) };
    expect(derive(band, NOW)).toEqual({ state: "home", placeId: "R001" });
    expect(derive({ ...band, contractEndAt: NOW }, NOW)).toEqual({ state: "gone" });
    // A band out on a march when its contract runs out is left out too.
    expect(derive({ ...band, contractEndAt: at(-1), movingTo: "R002", arrivesAt: at(HOUR) }, NOW)).toEqual({ state: "gone" });

    const levy = { startMen: 100, growthPerYear: 10, seasonsPerYear: 4 };
    expect(m.koinon.projectLevy({ men: 60, lastGrowthSeason: 4 }, 7, levy)).toBe(60);
    expect(m.koinon.projectLevy({ men: 60, lastGrowthSeason: 4 }, 8, levy)).toBe(70);
    expect(m.koinon.projectLevy({ men: 60, lastGrowthSeason: 4 }, 13, levy)).toBe(80);
    expect(m.koinon.projectLevy(null, 3, levy)).toBe(100);
    expect(m.koinon.projectLevy(null, 9, levy)).toBe(120);
  });
});
