# Festival world key, prompt 1: festivals are per world

## What this builds

World 2 deals almost no festivals. `festival_choregos`, the row that marks a festival instance as closed, is unique on `(festival_id, game_year)` with no world. `game_year` is `yearInGame`, which restarts at 0 with every world, so World 1's 73 closed rows shadow the same keys in World 2: `deliver` returns early and `closeDueFestivals` skips them. In production World 2 has zero Artemisia cards after a whole Spring (16 Sept 2026) with at least ten living characters. As it stands no donation festival fires until about day 97 of 182, apart from the one Dionysia of launch night.

This prompt makes festivals per world:

1. Migration 0060: `festival_choregos.world_id`, backfilled, NOT NULL, and the unique key becomes `(world_id, festival_id, game_year)`.
2. The lifecycle in `packages/db/src/festival.ts` reads and writes the active world only: the guard, the cards dealt, the donation totals, the auto-attend and the choregos trait strip.
3. The festival story gate in `apps/server/src/services/story.ts` only accepts a closed instance of the character's own world.
4. A DB-gated suite with two worlds in one database, and one new case in the story suite.

Rulings (Argiris, 17 Sept 2026):

- The missed Artemisia of Spring 300 BC gets no compensation. Nobody could donate, so nobody lost drachmae.
- World 2's Dionysia of 300 BC stands as closed, with whoever won it.
- The festival sweep's world scoping ships here. The Olympiad, spouse-death and merc-contract sweeps and the three character-keyed jobs stay in the worker prompt.
- Each existing `festival_choregos` row goes to the world that was running when it was closed: the world with the earliest `ends_at` later than the row's `closed_at`. `world:launch` stamped World 1's `ends_at` at the flip, while World 2's `started_at` is backdated to 00:00 UTC of launch day, so `started_at` cannot decide it. A row no world can claim fails the migration; nothing is deleted.
- The code ships as two patches inside this prompt. They were built and run against Postgres 16 before the prompt was written: build and lint clean, server 465, db 25 and worker 10 tests green, the new db suite 7 of 7. Against the lifecycle at 30a5a92 the same suite fails 6 of 7, and case (a) fails there with `expected [] to deeply equal ['fest-dionysia']`, which is the production bug. You apply them, read them against this spec, and gate them. You do not rewrite them.

## Dates

World 2 (`e873ced5-5435-4b64-a792-0421f72a91df`) started `2026-09-15T00:00:00Z`. Festivals in `content/calendar/calendar-config.json`: `fest-dionysia` season 1 (Winter), `fest-artemisia` season 2 (Spring), `fest-apollo` season 4 (Autumn), all yearly.

- Autumn 300 BC, Apollo: 2026-09-18 00:00 UTC to 2026-09-19 00:00 UTC. Delivery is lazy on `GET /me/state` and by the six-hourly sweep, so a fix that goes live at any point inside that day still deals Apollo to everyone who logs in after it.
- After that every real day that is not a Summer costs one festival. No gate is skipped for the date.

## Phase 0: recon (no code)

Confirm each reference at HEAD (expected `30a5a92`). If any is not as described, STOP 0 with the mismatch before writing anything.

- `packages/db/migrations/0018_festivals.sql` lines 33-40 declare `UNIQUE (festival_id, game_year)` inline, so Postgres named the constraint itself. `packages/db/src/schema.ts` names a unique index `festival_choregos_instance_idx` that no migration ever created.
- The last migration is `0059_users_beta_at.sql`. No `0060` exists.
- `packages/db/src/festival.ts`: `worldStartedMs` (19), `deliver` (24-35), `fireFestivalsForCharacterId` (38), `fireFestivalsForAll` (50), `closeDueFestivals` (70), `closeInstance` (99). `deliver` is the only place a donation-festival card is inserted.
- `worldStartedMs` is imported by `apps/server/src/services/festival.ts` and `packages/db/src/chronicle.ts`. It keeps its name and signature.
- `apps/server/src/services/story.ts` lines ~396-403: the `festival_events` to `festival_choregos` join on festival and year only.
- `apps/server/src/services/story.test.ts` line ~137: the `closeInstance` helper is the only other code that inserts a `festival_choregos` row.
- `packages/db/src/chronicle.ts` reads `festival_choregos` by `winner_character_id` and donations by character, so it is already per world. `resolveFestival` and `liveFestivalForCharacter` in the server's festival service are keyed by character as well. None of them changes.
- No test at HEAD calls `fireFestivalsForAll`, `fireFestivalsForCharacterId` or `closeDueFestivals`.
- `packages/db/src/worldLaunch.ts` line ~111 sets the old world's `endsAt` to the flip instant.

Production reads, through `railway run --service Postgres --environment production` with `DATABASE_PUBLIC_URL`, selects only:

1. `select conname, pg_get_constraintdef(oid) from pg_constraint where conrelid = 'festival_choregos'::regclass order by 1;`
   Expected: `festival_choregos_festival_id_game_year_key` as `UNIQUE (festival_id, game_year)`, the primary key and the winner foreign key.
2. `select id, name, status, started_at, ends_at from worlds order by started_at;`
   Expected: World 1 `04e99001-d2d2-4acb-ba43-1909233a6772` ended with `ends_at` at the flip (2026-09-15, about 20:08 UTC); World 2 `e873ced5-5435-4b64-a792-0421f72a91df` active from 2026-09-15 00:00 UTC to 2027-03-16.
3. The classification the migration will make:
   `select w.name, count(*) from festival_choregos fc left join lateral (select x.name from worlds x where x.ends_at > fc.closed_at order by x.ends_at asc limit 1) w on true group by 1 order by 1;`
   Expected: Massalia Season One 73, Massalia World 2 1, no NULL group.
4. The rows that go to World 2:
   `select fc.festival_id, fc.game_year, fc.closed_at, fc.winner_character_id from festival_choregos fc where (select x.id from worlds x where x.ends_at > fc.closed_at order by x.ends_at asc limit 1) = 'e873ced5-5435-4b64-a792-0421f72a91df';`
   Expected: exactly one row, `fest-dionysia` year 0, closed on 2026-09-16.
5. Winners in another world than their row:
   `select count(*) from festival_choregos fc join player_characters pc on pc.id = fc.winner_character_id where pc.world_id <> (select x.id from worlds x where x.ends_at > fc.closed_at order by x.ends_at asc limit 1);`
   Expected: 0.
6. When the ten World 2 Dionysia cards were dealt:
   `select min(fe.created_at), max(fe.created_at), count(*) from festival_events fe join player_characters pc on pc.id = fe.character_id where pc.world_id = 'e873ced5-5435-4b64-a792-0421f72a91df' and fe.festival_id = 'fest-dionysia' and fe.game_year = 0;`
   Expected: 10 cards, all between the flip and 2026-09-16 00:00 UTC.

STOP 0 if select 3 shows a NULL group or any split other than 73 and 1, if select 4 returns anything but that one row, if its `closed_at` is in June, or if select 5 is not 0. Any of those means the reading behind this prompt is wrong.

## What the patches do (read them against this)

Migration `0060_festival_world_key.sql`, idempotent, one transaction:

- adds `world_id uuid REFERENCES worlds(id)`, backfills it by the ruling above, sets it NOT NULL;
- drops the old unique constraint by its definition, never by a guessed name, and drops `festival_choregos_instance_idx` if some database has it;
- creates the unique index `festival_choregos_world_instance_idx` on `(world_id, festival_id, game_year)`.

`packages/db/src/schema.ts`: `festivalChoregos` gains `worldId` (NOT NULL, references `worlds`), and its unique index is declared under the new name on the three columns.

`packages/db/src/festival.ts`:

- a private `activeWorld()` returns the active world's id and start; `worldStartedMs()` stays exported and reads through it;
- `deliver` takes the world id and checks the guard by world, festival and year;
- `fireFestivalsForCharacterId` deals only to a living character of the active world;
- `fireFestivalsForAll` sweeps only the active world's living characters;
- `closeDueFestivals` builds its instances from the active world's cards and donations and reads only that world's guard rows;
- `closeInstance` takes the world id: donation totals, the choregos trait strip and the auto-attend are limited to that world's characters, and the guard row carries `worldId`;
- no exported signature changes, so the server's festival service, `routes/me.ts` and the worker need no edit.

`apps/server/src/services/story.ts`: the EXISTS subquery joins `player_characters` on the card's character and adds `festival_choregos.world_id = player_characters.world_id` to the join.

Tests: `packages/db/src/festival.test.ts` (new, seven cases (a) to (g), an ended world and an active world in one database); `apps/server/src/services/story.test.ts` (the `closeInstance` helper passes `worldId`; new case 12b, where only another world's instance of the same festival and year is closed).

Read both patches before applying them. If anything in them disagrees with the rulings or with this section, or looks wrong to you, STOP with the line. Do not edit a patch silently.

## Phase 1: the key and the lifecycle (one commit)

1. Save this prompt verbatim as `docs/festivals/festival-world-key-prompt-1.md`.
2. Extract Patch A (the single fenced block under the "Patch A" heading at the end of this prompt, fence lines excluded) to a temporary file outside the repo, with a script rather than by retyping. Its sha256 is `179b4fd51d63dad236352763692c119b7ed480f8de1ae5ad4a01f5973a2f5d3e`. `git apply --check` it, then `git apply` it.
3. After applying, these files must hash to:
   - `c7d8345e74f859cb642177406e17d5222d4efefbe6ad236858c16f47a4e36170`  `packages/db/migrations/0060_festival_world_key.sql`
   - `77ef926666a79467e11ff3721589650f4eaa41d0064b5cf9fcb8a508455dd50a`  `packages/db/src/schema.ts`
   - `ae68a6b6dd2a349d48f0c7014ac3267522d588293b8b48afeccc2f0ecf88e891`  `packages/db/src/festival.ts`
   - `234026a93878f8a307998d8adf20e28067796fce4c42e4bf403adf7071911cab`  `packages/db/src/festival.test.ts`
   - `1b8f80a4573906c797bace22bf293b052dd8a525737d9991aef2719eb79c9246`  `apps/server/src/services/story.test.ts`
   If the patch hash differs (a paste can strip trailing spaces) but `git apply --check` passes and the five file hashes match, carry on and say so in the report. If a file hash differs, STOP.
4. Against the migrated `massalia_test`: `pnpm --filter @massalia/shared build && pnpm --filter @massalia/db build`, `pnpm db:migrate` (0060 applies), then `pnpm --filter @massalia/db exec vitest run src/festival.test.ts` (7 of 7) and `pnpm --filter @massalia/server exec vitest run src/services/story.test.ts` (26 of 26).

Stage the five files and the prompt copy.

Commit: `festivals: the close guard and the lifecycle are per world (migration 0060)`.

## Phase 2: the story gate (one commit)

1. Extract Patch B the same way. Its sha256 is `7c317508143e3699dfdeaad3b1eb776bd251d54283a63fcf0f96b0b976e53184`. `git apply --check`, then `git apply`.
2. After applying:
   - `86a4c8281813609722ea0dbb3c4b342025b168520e4ac75b2ab1d9548437c2a8`  `apps/server/src/services/story.ts`
   - `ff9c2475a63892efeac4a2fd0627132db209e3b9cf6ee587e461dd4e8d1433b7`  `apps/server/src/services/story.test.ts`
3. `pnpm --filter @massalia/server exec vitest run src/services/story.test.ts`: 27 of 27, case 12b among them.

Stage the two files.

Commit: `story gate: a closed instance must be this world's`.

## Gate and STOP 1

`DATABASE_URL=…/massalia_test pnpm gate` at HEAD after the last commit, tree clean. Expected suites: shared 588, server 465, db 25, web 55, worker 10, none skipped. No push. Report:

```
Committed: <SHA> festivals: the close guard and the lifecycle are per world (migration 0060)
Committed: <SHA> story gate: a closed instance must be this world's
Production reads: constraint <name>; worlds <two rows>; classification <n> and <n>, NULL <n>; World 2 rows <list with closed_at>; winner mismatches <n>; Dionysia cards <count>, <min> to <max>
Patches: A <hash matched | differs, files matched>, B <same>; file hashes <all matched | list>
Read-through: <anything in the patches you would question, or "nothing">
Suites: db festival <n>/7, story <n>/27
Gate: <last line of pnpm gate>, <wall clock>; shared <n>, server <n>, db <n>, web <n>, worker <n>, skipped <n>
Deviations: <each as a ruling for Argiris, or "none">
Post-deploy checks for the push prompt: 0060 in __massalia_migrations; select world_id, count(*) from festival_choregos group by 1 gives 73 and 1; no UNIQUE (festival_id, game_year) left in pg_constraint; during Autumn 300 BC, fest-apollo cards of game year 0 appear for World 2 characters after a login.
```

## Scope fence

Do not touch: the worker (`apps/worker`), the Olympiad, spouse-death and merc-contract sweeps, the three character-keyed jobs, `apps/server/src/services/festival.ts`, `routes/me.ts`, `routes/festival.ts`, `packages/db/src/chronicle.ts`, the web client, any content file, any festival balance or wording, `packages/db/src/seed.ts`, `AGENTS.md` and the other docs. No second migration. No compensation card, no re-firing of the missed Artemisia, no change to World 2's closed Dionysia. No production write of any kind: the migration reaches production through the deploy, after the push prompt. No refactors along the way, the non-transactional shape of `closeInstance` included.

## Patch A

````diff
diff --git a/apps/server/src/services/story.test.ts b/apps/server/src/services/story.test.ts
index 05a646d..5ea6bc5 100644
--- a/apps/server/src/services/story.test.ts
+++ b/apps/server/src/services/story.test.ts
@@ -133,8 +133,8 @@ suite("story play service (integration)", () => {
       resolvedChoiceId: opts.resolvedChoiceId ?? null,
     });
   // The once-per-instance close guard (winner may be null — a winnerless close).
-  const closeInstance = async (festivalId: string, gameYear: number, winner: string | null = null) =>
-    db.insert(m.dbPkg.festivalChoregos).values({ festivalId, gameYear, winnerCharacterId: winner });
+  const closeInstance = async (festivalId: string, gameYear: number, winner: string | null = null, inWorld: string = worldId) =>
+    db.insert(m.dbPkg.festivalChoregos).values({ worldId: inWorld, festivalId, gameYear, winnerCharacterId: winner });
 
   const expectedStat = (base: number, amount: number, growthMultiplier: string) =>
     m.shared.capStat(base + m.shared.applyStatGrowth(amount, Number(growthMultiplier)), m.age.getAgeConfig());
diff --git a/packages/db/migrations/0060_festival_world_key.sql b/packages/db/migrations/0060_festival_world_key.sql
new file mode 100644
index 0000000..b9cc00d
--- /dev/null
+++ b/packages/db/migrations/0060_festival_world_key.sql
@@ -0,0 +1,33 @@
+-- Festival instances are per world (festival world key, prompt 1). game_year
+-- restarts with every world, so the close guard must carry the world: without it
+-- World 1's closed (festival, year) rows shadowed World 2's festivals. Each
+-- existing row goes to the world that was running when it was closed: the world
+-- with the earliest ends_at later than closed_at. world:launch stamps ends_at at
+-- the flip, while a new world's started_at may be backdated, so started_at cannot
+-- decide it. A row no world can claim fails SET NOT NULL and aborts the migration.
+-- Idempotent, one transaction.
+ALTER TABLE festival_choregos ADD COLUMN IF NOT EXISTS world_id uuid REFERENCES worlds(id);
+
+UPDATE festival_choregos fc
+SET world_id = (SELECT w.id FROM worlds w WHERE w.ends_at > fc.closed_at ORDER BY w.ends_at ASC LIMIT 1)
+WHERE fc.world_id IS NULL;
+
+ALTER TABLE festival_choregos ALTER COLUMN world_id SET NOT NULL;
+
+-- 0018 declared UNIQUE (festival_id, game_year) inline, so Postgres named the
+-- constraint itself. Drop it by definition, never by a guessed name.
+DO $$
+DECLARE c record;
+BEGIN
+  FOR c IN
+    SELECT conname FROM pg_constraint
+    WHERE conrelid = 'festival_choregos'::regclass AND contype = 'u'
+      AND pg_get_constraintdef(oid) = 'UNIQUE (festival_id, game_year)'
+  LOOP
+    EXECUTE format('ALTER TABLE festival_choregos DROP CONSTRAINT %I', c.conname);
+  END LOOP;
+END $$;
+DROP INDEX IF EXISTS festival_choregos_instance_idx;
+
+CREATE UNIQUE INDEX IF NOT EXISTS festival_choregos_world_instance_idx
+  ON festival_choregos (world_id, festival_id, game_year);
diff --git a/packages/db/src/festival.test.ts b/packages/db/src/festival.test.ts
new file mode 100644
index 0000000..9a695ab
--- /dev/null
+++ b/packages/db/src/festival.test.ts
@@ -0,0 +1,133 @@
+import { readFileSync } from "node:fs";
+import { dirname, resolve } from "node:path";
+import { fileURLToPath } from "node:url";
+import { and, eq, sql } from "drizzle-orm";
+import { beforeAll, beforeEach, describe, expect, it } from "vitest";
+import { parseCalendarConfig } from "@massalia/shared";
+
+// Festivals are per world. game_year restarts with every world, so an ended
+// world's closed (festival, year) rows, donations, cards and choregos trait must
+// never reach into the active world. Integration test against a REAL Postgres,
+// guarded to a *_test database (mirrors pops.test.ts).
+
+const dbUrl = process.env.DATABASE_URL ?? "";
+const suite = describe.runIf(dbUrl.includes("_test"));
+
+const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
+const cfg = parseCalendarConfig(JSON.parse(readFileSync(resolve(root, "content/calendar/calendar-config.json"), "utf8")));
+const DAY = 86_400_000;
+const HOUR = 3_600_000;
+const T0 = Date.UTC(2000, 0, 1);
+const WINTER_Y0 = new Date(T0 + HOUR); // Dionysia's season
+const SPRING_Y0 = new Date(T0 + DAY + HOUR); // Dionysia is past
+
+suite("festival lifecycle is per world (integration)", () => {
+  let db: Awaited<ReturnType<typeof load>>["db"];
+  let dbPkg: Awaited<ReturnType<typeof load>>["dbPkg"];
+  let oldWorld: string;
+  let liveWorld: string;
+
+  async function load() {
+    const dbPkg = await import("./index.js");
+    return { dbPkg, db: dbPkg.createDb() };
+  }
+
+  async function character(worldId: string, name: string): Promise<string> {
+    const user = (await db.insert(dbPkg.users).values({ email: `${name}-${Math.random().toString(36).slice(2)}@t`, passwordHash: "x" }).returning())[0]!;
+    const player = (await db.insert(dbPkg.players).values({ worldId, userId: user.id, name, color: "#123456", houseSlug: "test-house" }).returning())[0]!;
+    return (await db.insert(dbPkg.playerCharacters).values({ playerId: player.id, worldId, houseSlug: "test-house", classId: "trader" }).returning())[0]!.id;
+  }
+  const cards = async (characterId: string) => db.select().from(dbPkg.festivalEvents).where(eq(dbPkg.festivalEvents.characterId, characterId));
+  const guards = async (worldId: string) => db.select().from(dbPkg.festivalChoregos).where(eq(dbPkg.festivalChoregos.worldId, worldId));
+  const holds = async (characterId: string, traitId: string) =>
+    (await db.select().from(dbPkg.characterTraits).where(and(eq(dbPkg.characterTraits.characterId, characterId), eq(dbPkg.characterTraits.traitId, traitId)))).length > 0;
+  const donate = (characterId: string, amount: number) => db.insert(dbPkg.festivalDonations).values({ characterId, festivalId: "fest-dionysia", gameYear: 0, amount });
+
+  beforeAll(async () => {
+    ({ db, dbPkg } = await load());
+  });
+
+  beforeEach(async () => {
+    await db.execute(sql`TRUNCATE TABLE festival_choregos, festival_donations, festival_events, character_traits, player_characters, dynasties, players, sessions, users, worlds CASCADE`);
+    await db.insert(dbPkg.houses).values({ slug: "test-house", name: "House Test", initial: "T", alignment: "c", stance: "s", motto: "m", patron: "p", crest: "c" }).onConflictDoNothing();
+    oldWorld = (await db.insert(dbPkg.worlds).values({ name: "Old", seed: "fest-old", startedAt: new Date(T0 - 100 * DAY), endsAt: new Date(T0), status: "ended" }).returning())[0]!.id;
+    liveWorld = (await db.insert(dbPkg.worlds).values({ name: "Live", seed: "fest-live", startedAt: new Date(T0), endsAt: new Date(T0 + 182 * DAY), status: "active" }).returning())[0]!.id;
+    // The ended world closed the same (festival, year) keys long ago.
+    await db.insert(dbPkg.festivalChoregos).values([
+      { worldId: oldWorld, festivalId: "fest-dionysia", gameYear: 0, winnerCharacterId: null },
+      { worldId: oldWorld, festivalId: "fest-artemisia", gameYear: 0, winnerCharacterId: null },
+    ]);
+  });
+
+  it("(a) an ended world's closed instance does not shadow the active world's festival", async () => {
+    const a = await character(liveWorld, "A");
+    const b = await character(liveWorld, "B");
+    expect(await dbPkg.fireFestivalsForAll(cfg, WINTER_Y0)).toBe(2);
+    expect((await cards(a)).map((c) => c.festivalId)).toEqual(["fest-dionysia"]);
+    expect((await cards(b)).map((c) => c.festivalId)).toEqual(["fest-dionysia"]);
+  });
+
+  it("(b) a living character of an ended world is dealt nothing, by the sweep or on its own", async () => {
+    const ghost = await character(oldWorld, "Ghost");
+    await character(liveWorld, "A");
+    expect(await dbPkg.fireFestivalsForAll(cfg, WINTER_Y0)).toBe(1);
+    await dbPkg.fireFestivalsForCharacterId(ghost, cfg, WINTER_Y0);
+    expect(await cards(ghost)).toHaveLength(0);
+  });
+
+  it("(c) the close counts only the active world's donations and writes that world's guard row", async () => {
+    const ghost = await character(oldWorld, "Ghost");
+    const a = await character(liveWorld, "A");
+    const b = await character(liveWorld, "B");
+    await dbPkg.fireFestivalsForAll(cfg, WINTER_Y0);
+    await donate(ghost, 500);
+    await donate(a, 30);
+    await donate(b, 50);
+    expect(await dbPkg.closeDueFestivals(cfg, SPRING_Y0)).toBe(1);
+    const live = await guards(liveWorld);
+    expect(live).toHaveLength(1);
+    expect(live[0]).toMatchObject({ festivalId: "fest-dionysia", gameYear: 0, winnerCharacterId: b });
+    expect(await holds(b, "megas-choregos")).toBe(true);
+    expect(await holds(ghost, "megas-choregos")).toBe(false);
+    expect(await guards(oldWorld)).toHaveLength(2); // untouched
+  });
+
+  it("(d) the trait strip stays inside the world", async () => {
+    const ghost = await character(oldWorld, "Ghost");
+    const former = await character(liveWorld, "Former");
+    const a = await character(liveWorld, "A");
+    await db.insert(dbPkg.characterTraits).values([{ characterId: ghost, traitId: "megas-choregos" }, { characterId: former, traitId: "megas-choregos" }]);
+    await dbPkg.fireFestivalsForAll(cfg, WINTER_Y0);
+    await donate(a, 10);
+    await dbPkg.closeDueFestivals(cfg, SPRING_Y0);
+    expect(await holds(a, "megas-choregos")).toBe(true);
+    expect(await holds(former, "megas-choregos")).toBe(false);
+    expect(await holds(ghost, "megas-choregos")).toBe(true);
+  });
+
+  it("(e) the auto-attend stays inside the world", async () => {
+    const ghost = await character(oldWorld, "Ghost");
+    const a = await character(liveWorld, "A");
+    await db.insert(dbPkg.festivalEvents).values({ characterId: ghost, festivalId: "fest-dionysia", eventId: "fest-dionysia", gameYear: 0, resolved: false });
+    await dbPkg.fireFestivalsForAll(cfg, WINTER_Y0);
+    await dbPkg.closeDueFestivals(cfg, SPRING_Y0);
+    expect((await cards(a))[0]).toMatchObject({ resolved: true, resolvedChoiceId: "attend" });
+    expect((await cards(ghost))[0]).toMatchObject({ resolved: false, resolvedChoiceId: null });
+  });
+
+  it("(f) the guard still guards inside its own world", async () => {
+    const a = await character(liveWorld, "A");
+    await db.insert(dbPkg.festivalChoregos).values({ worldId: liveWorld, festivalId: "fest-dionysia", gameYear: 0, winnerCharacterId: null });
+    await dbPkg.fireFestivalsForAll(cfg, WINTER_Y0);
+    expect(await cards(a)).toHaveLength(0);
+  });
+
+  it("(g) a second close is a no-op", async () => {
+    const a = await character(liveWorld, "A");
+    await dbPkg.fireFestivalsForAll(cfg, WINTER_Y0);
+    await donate(a, 10);
+    expect(await dbPkg.closeDueFestivals(cfg, SPRING_Y0)).toBe(1);
+    expect(await dbPkg.closeDueFestivals(cfg, SPRING_Y0)).toBe(0);
+    expect(await guards(liveWorld)).toHaveLength(1);
+  });
+});
diff --git a/packages/db/src/festival.ts b/packages/db/src/festival.ts
index 4a15eb0..992ba38 100644
--- a/packages/db/src/festival.ts
+++ b/packages/db/src/festival.ts
@@ -1,4 +1,4 @@
-import { and, eq } from "drizzle-orm";
+import { and, eq, inArray } from "drizzle-orm";
 import {
   festivalById,
   festivalSeasonOfYear,
@@ -15,17 +15,28 @@ const db = createDb();
 // DB-level festival lifecycle, shared by the server (lazy-on-read) and the BullMQ
 // worker (scheduled sweep) — like the family rolls. Config is passed in; the
 // choregos trait is unconstrained (reputation), so it is granted/stripped directly.
+//
+// Festivals are per world. game_year restarts with every world, so every read and
+// write below is scoped to the active world: the close guard by its world_id, cards
+// and donations through their character's world.
+
+async function activeWorld(): Promise<{ id: string; startedMs: number } | null> {
+  const rows = await db.select({ id: worlds.id, startedAt: worlds.startedAt }).from(worlds).where(eq(worlds.status, "active")).limit(1);
+  return rows[0] ? { id: rows[0].id, startedMs: rows[0].startedAt.getTime() } : null;
+}
 
 export async function worldStartedMs(): Promise<number | null> {
-  const rows = await db.select({ startedAt: worlds.startedAt }).from(worlds).where(eq(worlds.status, "active")).limit(1);
-  return rows[0] ? rows[0].startedAt.getTime() : null;
+  return (await activeWorld())?.startedMs ?? null;
 }
 
-async function deliver(characterId: string, festival: Festival, gameYear: number): Promise<void> {
+// The active world's characters, as a subquery for IN (...).
+const charactersOf = (worldId: string) => db.select({ id: playerCharacters.id }).from(playerCharacters).where(eq(playerCharacters.worldId, worldId));
+
+async function deliver(worldId: string, characterId: string, festival: Festival, gameYear: number): Promise<void> {
   const closed = await db
     .select({ id: festivalChoregos.id })
     .from(festivalChoregos)
-    .where(and(eq(festivalChoregos.festivalId, festival.id), eq(festivalChoregos.gameYear, gameYear)))
+    .where(and(eq(festivalChoregos.worldId, worldId), eq(festivalChoregos.festivalId, festival.id), eq(festivalChoregos.gameYear, gameYear)))
     .limit(1);
   if (closed.length > 0) return;
   await db
@@ -34,47 +45,58 @@ async function deliver(characterId: string, festival: Festival, gameYear: number
     .onConflictDoNothing();
 }
 
-// Deliver any festival firing now to a single (living) character.
+// Deliver any festival firing now to a single living character of the active world.
 export async function fireFestivalsForCharacterId(characterId: string, cfg: CalendarConfig, now: Date = new Date()): Promise<void> {
-  const started = await worldStartedMs();
-  if (started === null) return;
-  const rows = await db.select({ status: playerCharacters.status }).from(playerCharacters).where(eq(playerCharacters.id, characterId)).limit(1);
-  if (rows[0]?.status !== "alive") return;
-  const gd = gameDate(now.getTime(), started);
+  const world = await activeWorld();
+  if (!world) return;
+  const rows = await db.select({ status: playerCharacters.status, worldId: playerCharacters.worldId }).from(playerCharacters).where(eq(playerCharacters.id, characterId)).limit(1);
+  if (rows[0]?.status !== "alive" || rows[0].worldId !== world.id) return;
+  const gd = gameDate(now.getTime(), world.startedMs);
   for (const festival of festivalsFiringAt(cfg, gd.seasonOfYear, gd.yearInGame)) {
-    await deliver(characterId, festival, gd.yearInGame);
+    await deliver(world.id, characterId, festival, gd.yearInGame);
   }
 }
 
-// The global sweep: deliver to EVERY active living character.
+// The global sweep: deliver to every active living character of the active world.
 export async function fireFestivalsForAll(cfg: CalendarConfig, now: Date = new Date()): Promise<number> {
-  const started = await worldStartedMs();
-  if (started === null) return 0;
-  const gd = gameDate(now.getTime(), started);
+  const world = await activeWorld();
+  if (!world) return 0;
+  const gd = gameDate(now.getTime(), world.startedMs);
   const firing = festivalsFiringAt(cfg, gd.seasonOfYear, gd.yearInGame);
   if (firing.length === 0) return 0;
   const living = await db
     .select({ id: playerCharacters.id })
     .from(playerCharacters)
     .innerJoin(players, eq(players.id, playerCharacters.playerId))
-    .where(and(eq(playerCharacters.status, "alive"), eq(players.isActive, true)));
+    .where(and(eq(playerCharacters.worldId, world.id), eq(playerCharacters.status, "alive"), eq(players.isActive, true)));
   for (const row of living) {
-    for (const festival of firing) await deliver(row.id, festival, gd.yearInGame);
+    for (const festival of firing) await deliver(world.id, row.id, festival, gd.yearInGame);
   }
   return living.length;
 }
 
-// Close every donation instance whose season has passed: crown the top donor as
-// the choregos (revoking the prior holder), auto-resolve untouched events to
-// "attend", mark closed. Idempotent. Returns the number of instances closed.
+// Close every donation instance of the active world whose season has passed: crown
+// the top donor as the choregos (revoking the prior holder), auto-resolve untouched
+// events to "attend", mark closed. Idempotent. Returns the number of instances closed.
 export async function closeDueFestivals(cfg: CalendarConfig, now: Date = new Date()): Promise<number> {
-  const started = await worldStartedMs();
-  if (started === null) return 0;
-  const gd = gameDate(now.getTime(), started);
+  const world = await activeWorld();
+  if (!world) return 0;
+  const gd = gameDate(now.getTime(), world.startedMs);
 
-  const fromEvents = await db.select({ festivalId: festivalEvents.festivalId, gameYear: festivalEvents.gameYear }).from(festivalEvents);
-  const fromDonations = await db.select({ festivalId: festivalDonations.festivalId, gameYear: festivalDonations.gameYear }).from(festivalDonations);
-  const closedRows = await db.select({ festivalId: festivalChoregos.festivalId, gameYear: festivalChoregos.gameYear }).from(festivalChoregos);
+  const fromEvents = await db
+    .select({ festivalId: festivalEvents.festivalId, gameYear: festivalEvents.gameYear })
+    .from(festivalEvents)
+    .innerJoin(playerCharacters, eq(playerCharacters.id, festivalEvents.characterId))
+    .where(eq(playerCharacters.worldId, world.id));
+  const fromDonations = await db
+    .select({ festivalId: festivalDonations.festivalId, gameYear: festivalDonations.gameYear })
+    .from(festivalDonations)
+    .innerJoin(playerCharacters, eq(playerCharacters.id, festivalDonations.characterId))
+    .where(eq(playerCharacters.worldId, world.id));
+  const closedRows = await db
+    .select({ festivalId: festivalChoregos.festivalId, gameYear: festivalChoregos.gameYear })
+    .from(festivalChoregos)
+    .where(eq(festivalChoregos.worldId, world.id));
   const closedKeys = new Set(closedRows.map((r) => `${r.festivalId}:${r.gameYear}`));
 
   const instances = new Map<string, { festivalId: string; gameYear: number }>();
@@ -90,17 +112,18 @@ export async function closeDueFestivals(cfg: CalendarConfig, now: Date = new Dat
     const season = festivalSeasonOfYear(festival);
     const past = gd.yearInGame > gameYear || (gd.yearInGame === gameYear && gd.seasonOfYear > season);
     if (!past) continue;
-    await closeInstance(festival, gameYear);
+    await closeInstance(world.id, festival, gameYear);
     closedCount++;
   }
   return closedCount;
 }
 
-async function closeInstance(festival: Festival, gameYear: number): Promise<void> {
+async function closeInstance(worldId: string, festival: Festival, gameYear: number): Promise<void> {
   const donations = await db
-    .select()
+    .select({ characterId: festivalDonations.characterId, amount: festivalDonations.amount, createdAt: festivalDonations.createdAt })
     .from(festivalDonations)
-    .where(and(eq(festivalDonations.festivalId, festival.id), eq(festivalDonations.gameYear, gameYear)));
+    .innerJoin(playerCharacters, eq(playerCharacters.id, festivalDonations.characterId))
+    .where(and(eq(playerCharacters.worldId, worldId), eq(festivalDonations.festivalId, festival.id), eq(festivalDonations.gameYear, gameYear)));
   const totals = new Map<string, { total: number; earliest: number }>();
   for (const d of donations) {
     const prev = totals.get(d.characterId) ?? { total: 0, earliest: d.createdAt.getTime() };
@@ -111,17 +134,17 @@ async function closeInstance(festival: Festival, gameYear: number): Promise<void
   const winner = ranked[0]?.[0] ?? null;
 
   if (winner && festival.choregosTraitId) {
-    // Strip the choregos trait from every prior holder, then crown the winner.
+    // Strip the choregos trait from every prior holder in this world, then crown the winner.
     await db
       .delete(characterTraits)
-      .where(and(eq(characterTraits.traitId, festival.choregosTraitId)));
+      .where(and(eq(characterTraits.traitId, festival.choregosTraitId), inArray(characterTraits.characterId, charactersOf(worldId))));
     await db.insert(characterTraits).values({ characterId: winner, traitId: festival.choregosTraitId }).onConflictDoNothing();
   }
 
   await db
     .update(festivalEvents)
     .set({ resolved: true, resolvedChoiceId: "attend" })
-    .where(and(eq(festivalEvents.festivalId, festival.id), eq(festivalEvents.gameYear, gameYear), eq(festivalEvents.resolved, false)));
+    .where(and(eq(festivalEvents.festivalId, festival.id), eq(festivalEvents.gameYear, gameYear), eq(festivalEvents.resolved, false), inArray(festivalEvents.characterId, charactersOf(worldId))));
 
-  await db.insert(festivalChoregos).values({ festivalId: festival.id, gameYear, winnerCharacterId: winner }).onConflictDoNothing();
+  await db.insert(festivalChoregos).values({ worldId, festivalId: festival.id, gameYear, winnerCharacterId: winner }).onConflictDoNothing();
 }
diff --git a/packages/db/src/schema.ts b/packages/db/src/schema.ts
index d55f386..7fa8dde 100644
--- a/packages/db/src/schema.ts
+++ b/packages/db/src/schema.ts
@@ -474,14 +474,17 @@ export const festivalDonations = pgTable("festival_donations", {
 }));
 
 // Closed festival instances + the crowned patron (each instance awards once).
+// Per world: game_year restarts with every world, so the guard carries world_id
+// (migration 0060).
 export const festivalChoregos = pgTable("festival_choregos", {
   id: uuid("id").primaryKey().defaultRandom(),
+  worldId: uuid("world_id").references(() => worlds.id).notNull(),
   festivalId: text("festival_id").notNull(),
   gameYear: integer("game_year").notNull(),
   winnerCharacterId: uuid("winner_character_id").references(() => playerCharacters.id),
   closedAt: timestamp("closed_at", { withTimezone: true }).notNull().defaultNow(),
 }, (table) => ({
-  oneClosePerInstance: uniqueIndex("festival_choregos_instance_idx").on(table.festivalId, table.gameYear),
+  oneClosePerInstance: uniqueIndex("festival_choregos_world_instance_idx").on(table.worldId, table.festivalId, table.gameYear),
 }));
 
 // The Olympiad (Prompt 8): cycle state, advanced through its phases by the
````

## Patch B

````diff
diff --git a/apps/server/src/services/story.test.ts b/apps/server/src/services/story.test.ts
--- a/apps/server/src/services/story.test.ts
+++ b/apps/server/src/services/story.test.ts
@@ -346,6 +346,14 @@
     expect(await m.story.availableStories(c.id, REG)).toEqual([]);
   });
 
+  it("12b. attended, and only another world's instance of the same festival and year is closed → []", async () => {
+    const c = await createCharacter("Shadowed");
+    await attend(c.id, "fest-test", 1);
+    const other = (await db.insert(m.dbPkg.worlds).values({ name: "Other", seed: "story-other", startedAt: now, endsAt: new Date(now.getTime() + 86_400_000), status: "ended" }).returning())[0]!;
+    await closeInstance("fest-test", 1, null, other.id);
+    expect(await m.story.availableStories(c.id, REG)).toEqual([]);
+  });
+
   it("13. auto-resolved attendance (resolved 'attend') still qualifies", async () => {
     const c = await createCharacter("Offline");
     await attend(c.id, "fest-test", 1, { resolved: true, resolvedChoiceId: "attend" });
diff --git a/apps/server/src/services/story.ts b/apps/server/src/services/story.ts
index bb65782..e0c0e11 100644
--- a/apps/server/src/services/story.ts
+++ b/apps/server/src/services/story.ts
@@ -2,7 +2,7 @@ import fs from "node:fs/promises";
 import path from "node:path";
 import { fileURLToPath } from "node:url";
 import { and, eq, exists, sql } from "drizzle-orm";
-import { createDb, festivalChoregos, festivalEvents, stories, storyProgress } from "@massalia/db";
+import { createDb, festivalChoregos, festivalEvents, playerCharacters, stories, storyProgress } from "@massalia/db";
 import { parseStoryTree, validateStoryGraph, type EventEffect, type NodeBody, type StoryNode, type StoryTree } from "@massalia/shared";
 import { applyEffectsInTx, getCityDefaults, getFactionDefaults } from "./eventEngine.js";
 import { applyChangeTrait, getTraitDef, TraitRuleError } from "./traits.js";
@@ -394,9 +394,11 @@ export async function availableStories(
             db
               .select({ id: festivalEvents.id })
               .from(festivalEvents)
+              .innerJoin(playerCharacters, eq(playerCharacters.id, festivalEvents.characterId))
               .innerJoin(
                 festivalChoregos,
                 and(
+                  eq(festivalChoregos.worldId, playerCharacters.worldId),
                   eq(festivalChoregos.festivalId, festivalEvents.festivalId),
                   eq(festivalChoregos.gameYear, festivalEvents.gameYear),
                 ),
````

END OF PROMPT
