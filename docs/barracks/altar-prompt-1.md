# The Altar: a bull or a chicken buys the army two seasons of morale

Save this prompt as docs/barracks/altar-prompt-1.md in the first commit.
Repo HEAD when this was drafted: e137ff4. One migration. One concern per commit, staged by path. Recon first and STOP only if something below does not match the code; otherwise build straight through to STOP 1. Commits stay local; no push until I say push.

## What it is

A player sacrifices a bull or a chicken at the Barracks altar. For the next two seasons (two real days, a duration from the act, not season boundaries) every row the player fields enters a battle with its morale raised: +3 for a bull, +1 for a chicken. Morale only moves the break threshold (a row breaks once its losses exceed mor × moraleStep), so +3 is 15 more percentage points of losses before a row breaks. The bull has had no consumer until now.

Rulings already made (6 Oct 2026): bull +3, chicken +1. A second sacrifice while the altar is lit is refused. No clamp (the highest content morale is 10, so 13 is the ceiling in practice). The blessing covers everything the player owns at fight time, bands and men recruited later included, and for a koinon muster each owner's blessing is checked at the launch time. No Chronicle line. The altar sits under the Mercenary market. The sacrifice is a plain Barracks action: it does not run the "offering" tag through the composure pipeline (a follow-up prompt may add the pious and skeptic reactions).

## Scope

Four commits; the first also saves this file. Touch only:
- docs/barracks/altar-prompt-1.md (this file)
- content/military/battle.json
- packages/shared/src/barracks.ts (BattleContent, battleContentSchema and parseBattleContent only)
- packages/shared/src/battle.test.ts (the content test and the parseBattleContent calls only)
- packages/shared/scripts/battle-calibration.ts (the parseBattleContent call only)
- packages/db/migrations/0065_altar.sql (new)
- packages/db/src/schema.ts (players table only)
- apps/server/src/services/barracks.ts
- apps/server/src/services/mapActions.ts (the import from ./barracks.js and the attacker rows at the battle only)
- apps/server/src/services/koinonMuster.ts (the import from ./barracks.js and the attacker rows at the battle only)
- apps/server/src/routes/barracks.ts
- apps/server/src/routes/barracks.test.ts (the View type, the config expectation at :121, and one POST /sacrifice case)
- apps/server/src/services/barracks.test.ts, mapActions.test.ts, koinonMuster.test.ts
- apps/web/src/api.ts
- apps/web/src/dashboard/panels/BarracksPanel.tsx
- apps/web/test/barracks-panel.test.tsx
- apps/web/test/towns-and-move.test.tsx (the Barracks-row move case's view and player only)

Do not touch: packages/shared/src/battle.ts (the resolver stays pure; the bonus is applied by its callers on a copy of the stats), the Chronicle (shared/chronicle.ts, db/chronicle.ts, FamilyPanel), routines, traits, the composure pipeline, StatChips, World2Map.tsx and the force picker, any other content file, AGENTS.md. No production write.

## Phase 0: recon (read only)

Confirm each of these. On any mismatch, STOP 0 and report.
- packages/shared/src/battle.ts:175 is the only use of `mor`: `if ((r.start - r.count) / r.start <= r.stats.mor * cfg.moraleStep) continue; r.broke = true;`. `live()` at :115 copies `stats: r.stats` and never recomputes them.
- apps/server/src/services/mapActions.ts:443-446 builds the attacker rows as `{ id: r.id, label: labelOf(r), count: r.count, stats: def!.stats }` with no multiplier; the battle instant is `now`.
- apps/server/src/services/koinonMuster.ts:741-744 builds the attacker rows the same way from `army`, rows from several owners (`r.ownerPlayerId`); the battle instant is `launchAt` (:619), and every owner is already locked (:615).
- content/military/battle.json has `moraleStep: 0.05` and no `altar` key; `battleContentSchema` in packages/shared/src/barracks.ts:230 is `.strict()` and a constant, and `parseBattleContent(data)` at :265 takes no goods, unlike `parseUnitsContent(data, knownGoods)`. Its callers: apps/server/src/services/barracks.ts:83 (the vendor goods are in hand at :79), packages/shared/src/battle.test.ts:13 and :34-37 (goods at :11), and packages/shared/scripts/battle-calibration.ts:19 (goods at :16). Shared's tsconfig compiles only `src`, so the gate never sees the script.
- `mutate()` at apps/server/src/services/barracks.ts:653-661 runs lockPlayer → settleAll → fn in one transaction; `debitResource` (:210-217, `WHERE amount >= qty`, boolean) is private to that file; the recruit flow (:679-691) reads stock, refuses "Short of …" before any debit, then debits under the lock.
- Every Barracks POST runs `acting()` and returns `barracksView(ctx, now)` on success; the militia gate (`gate.met`) is checked by recruit and hire.
- apps/server/src/routes/barracks.test.ts:121 pins `v.config` with `toEqual`, and its `View` type (:37) repeats the config shape.
- `players` in packages/db/src/schema.ts:159 is per world (`worldId`) and already carries `partyCooldownUntil` / `koinonCooldownUntil` timestamptz columns. The latest migration is 0064.
- apps/web/src/dashboard/panels/BarracksPanel.tsx: the Mercenary market is `<section data-section="market">` at :760; the generic `act(key, fn, okNote)` helper is at :513; the panel receives `player` (PanelProps) so `player.balances` is readable; the render test payload builder is `payload()` in apps/web/test/barracks-panel.test.tsx.
- apps/web/test/towns-and-move.test.tsx:246-276 mounts BarracksPanel with its own BarracksView and a player that has no `balances`.
- Balances are fractional floats (the Bull Farm yields 0.5 bull a day); the client floors them for display (MarketPanel.tsx:386).
- The map action's battle seed hashes the world and player ids (mapActions.ts:442), which mapActions.test.ts creates at random, so it changes on every run. The muster test fixes its ids (`uid(n)`) and LAUNCH, so its seed is fixed; the counts given below hold on any seed either way.

## Commit 1: docs and content: the altar config

1. Save this prompt file.
2. content/military/battle.json: add, after `"town"`:
   ```json
   "altar": { "seasons": 2, "goods": { "bull": 3, "chicken": 1 } },
   ```
   `goods` maps a vendor good id to the morale bonus. Balance stays in content.
3. packages/shared/src/barracks.ts: `BattleContent` gains `altar: { seasons: number; goods: Record<string, number> }`. `battleContentSchema` becomes a function of the known goods, as `unitsContentSchema` is, and gains `altar: z.object({ seasons: z.number().int().positive(), goods: goodsSchema(goods, "altar.goods") }).strict()`, so a typo in a good fails the boot. `parseBattleContent(data, knownGoods)` takes the goods as `parseUnitsContent` does. In this same commit, so it builds, pass the vendor goods at its three callers: apps/server/src/services/barracks.ts:83, packages/shared/src/battle.test.ts:13 and :34-37, packages/shared/scripts/battle-calibration.ts:19. Then run `pnpm --filter @massalia/shared battle:calibrate` once and check that it still prints its tables.
4. packages/shared/src/battle.test.ts "battle content": assert the real file parses with `altar.seasons === 2` and `altar.goods` equal to `{ bull: 3, chicken: 1 }`, and that an `altar` with an unknown good is rejected.

## Commit 2: db: the altar on the player

1. packages/db/migrations/0065_altar.sql, idempotent, with a comment header in the style of 0056:
   ```sql
   ALTER TABLE players ADD COLUMN IF NOT EXISTS altar_until timestamptz;
   ALTER TABLE players ADD COLUMN IF NOT EXISTS altar_good text;
   ```
   `altar_until`: the instant the blessing ends, `now + seasons × MS_PER_DAY` at the act (a duration, as training and contracts are since 0054). `altar_good`: the good burned, for the view. Both NULL when the altar is cold. Players are per world, so this is world-scoped by construction.
2. packages/db/src/schema.ts: `altarUntil: timestamp("altar_until", { withTimezone: true })` and `altarGood: text("altar_good")` on `players`, with a comment.

## Commit 3: server: the sacrifice, and the bonus at both battles

1. apps/server/src/services/barracks.ts:
   - `export async function sacrifice(ctx, good: string, now): Promise<SacrificeResult>`, `SacrificeResult = Failure | { ok: true; good: string; mor: number; until: Date }`, built on `mutate()` so upkeep is settled before the good is taken. In order:
     a. The militia gate, exactly as recruit refuses below it.
     b. `good` must be an own key of `battleC.altar.goods` (`Object.hasOwn`; an `in` check would let "constructor" through); otherwise 400 "The altar takes a bull or a chicken."
     c. Claim-first: `UPDATE players SET altar_until = <until>, altar_good = <good> WHERE id = ctx.playerId AND (altar_until IS NULL OR altar_until <= now) RETURNING id`. No row → 409 "The altar still smokes from the last offering." The claim comes before the debit so a double click cannot burn two beasts.
     d. The guarded debit of one unit of the good (`debitResource`). A failed debit throws inside the transaction (rolling the claim back) and the caller answers 409 "You have no bull for this — the agora sells them." (the routine's wording, with the good's id).
     e. `logEffect(characterId, "barracks_sacrifice", { good, mor, until })`. Audit only; it is not a Chronicle kind and must not be added to CHRONICLE_EFFECT_LOG_KINDS.
   - `export async function altarBonusFor(exec, playerIds: string[], at: Date): Promise<Map<string, number>>`: one query over `players` for the ids, returning the morale bonus for each player whose blessing was lit at `at`, meaning `altar_until > at` and `altar_until - seasons × MS_PER_DAY <= at`, from `battleC.altar.goods[altar_good]`, else 0. The second condition is for the muster: it resolves lazily, and the hook skips a muster another request holds (koinonMuster.ts:605) or one whose resolve threw in the last minute (:870), so a beast burned after the launch must not count. The caller must hold the lock on those players (both battle sites already do).
   - `BarracksView` gains `altar: { good: string; mor: number; until: string } | null` (null when cold or expired at `now`) and `config.altar: { seasons: number; goods: Record<string, number> }` so the client draws one button per good from content.
2. apps/server/src/services/mapActions.ts:443-446: before the rows are built, `const bonus = (await altarBonusFor(tx, [ctx.playerId], now)).get(ctx.playerId) ?? 0`; each row becomes `stats: bonus ? { ...def!.stats, mor: def!.stats.mor + bonus } : def!.stats`. Never mutate `def.stats` (it is the shared content object). No clamp.
3. apps/server/src/services/koinonMuster.ts:741-744: the same with `altarBonusFor(tx, owners, launchAt)` and each row's `r.ownerPlayerId`. The instant is `launchAt`, not the request time.
4. apps/server/src/routes/barracks.ts: `POST /sacrifice` with body `{ good: string }`, the hire handler's shape (acting → service → `barracksView` on success, `reply.code(result.code)` + `{ error }` on failure).
5. Tests:
   - barracks.test.ts: a bull in stock is burned (stock 1 → 0), the view's `altar` reads `{ good: "bull", mor: 3 }` with `until` two days out; a chicken gives mor 1; with no bull the sacrifice is refused with the 409 and nothing changes; a second sacrifice while lit is refused with the altar message and the stock is untouched; after two days `altar` is null and a sacrifice is accepted again; below the militia gate it is refused like recruit; an unknown good is 400.
   - routes/barracks.test.ts: the `View` type and the config expectation at :121 gain the altar; one `POST /sacrifice` case in the shape of the other four: a bull in stock returns the view with the altar lit, a second is 409, a missing good is 400.
   - mapActions.test.ts: the attacker rows enter the battle with the bonus. The seed changes every run, so use these counts, checked against the real resolver and content on 3000 random seeds: `makePlayer()`, `setWarband("R046", 90, at(9))`, 40 hoplites by `insertRow`, Attack on Salyes. Unblessed, the winner is "defender" and the line starts "Attacked Salyes with 40 hoplites and were broken" on every seed; with a bull lit before at(9), the winner is "stand" and the line starts "Attacked Salyes with 40 hoplites and withdrew" on every seed. Also: a blessing that expired before `now` gives nothing (the same fight reads "were broken").
   - koinonMuster.test.ts: two members pledge 60 hoplites each (`musterRow`, `pledgedMen`) to a raid on `landRegion` with `setWarband(landRegion, 660)`; one member's bull is lit before LAUNCH and runs past it, the other's altar is cold. On 3000 random seeds the cold owner's `parts[].lost` is 27 to 30 and the blessed owner's 24 to 26 (both 27 to 30 with no blessing, both 24 to 26 with two), so assert cold >= 27 and blessed <= 26. Also, through `altarBonusFor` at `launchAt`: a bull lit before the launch that expired at it gives 0, and a bull lit after the launch gives 0.

## Commit 4: web: the Altar under the Mercenary market

1. apps/web/src/api.ts: `BarracksView` gains the same `altar` and `config.altar` fields; `barracksSacrifice: (good: string) => apiFetch<BarracksView>("/api/barracks/sacrifice", { method: "POST", body: { good } })`.
2. apps/web/src/dashboard/panels/BarracksPanel.tsx: a new `<section className="barracks-section" data-section="altar" aria-label="Altar">` directly after the market section.
   - `SectionHead` title "Altar". Note while cold: "A beast burned here steadies every man you field for 2 seasons." (the 2 from `view.config.altar.seasons`). While lit: "The altar smokes · +3 morale to every man you field · <countdown to until>" (the +3 from `view.altar.mor`), with the countdown on the server clock as the other timers are (`useCountdownSeconds` / `onDeviceClock`), in a component of its own since the panel returns early while the view loads. At zero it calls the panel's `onZero` with the key `altar:<until>`, as the roster timers do, so the view refetches and the altar goes cold.
   - One button per entry of `view.config.altar.goods`, in the order bull, chicken: "Sacrifice a bull · +3 morale · you have N" where N is `Math.floor(player.balances[good] ?? 0)` (balances are fractional; the Market floors them the same way). Disabled while the altar is lit, while `busy`, below the gate (the same `locked` / `lockReason` as the other actions), and when N is 0 (then the button reads "… · none in stock"). The click runs `act(\`sacrifice:${good}\`, () => api.barracksSacrifice(good), "The altar is lit.")`; the error for that key shows beside the button as hire errors do.
   - The wording above is mine and yours to change at STOP 1.
3. apps/web/test/barracks-panel.test.tsx, in the payload builder add `altar: null` and `config.altar: { seasons: 2, goods: { bull: 3, chicken: 1 } }`, and a player with `balances: { bull: 1, chicken: 0.5 }`. Cases: cold altar renders two buttons, the bull enabled with "you have 1" and the chicken disabled with "none in stock" (half a chicken floors to none); clicking the bull calls `api.barracksSacrifice("bull")` once and the panel re-renders from the returned view; a lit altar (`altar: { good: "bull", mor: 3, until: iso(NOW + 30 * H) }`) shows the smoking note with "+3 morale" and both buttons disabled; locked (below the gate) disables both with the lock reason.
4. apps/web/test/towns-and-move.test.tsx: the Barracks-row move case's view gains `altar: null` and the same `config.altar`, and its player gets `balances: {}`. No assertion changes; without this the new section throws in that test.

## Gate and STOP 1

Run `DATABASE_URL=…/massalia_test pnpm gate` at HEAD after commit 4, then `pnpm audit --audit-level=high`. The gate must end `GATE GREEN: HEAD <sha>, tree clean` and the audit must exit 0. A red from a timeout in a suite this diff does not touch is a STOP with the log; never rerun to get a pass. Commit only on a read exit code.

STOP 1. Report:
- Committed: <SHA> <subject>, one line per commit
- Gate: the last line, suite counts; the audit exit code; the `battle:calibrate` exit code
- The migration's SQL, verbatim
- Each new test by name, and any fixture count that differs from the ones given above, with the reason
- The altar section's wording as rendered, for ruling
- Any deviation, as a question for a ruling

## Push (only after I reply "push")

Fast-forward only, plain `git push`. Report remote HEAD, the CI run with its Gate and Audit steps, Railway server and worker on the new SHA with the deploy log's `Applying 0065_altar.sql` line, Pages green, API health, and in production a read-only select confirming 0065 in `__massalia_migrations`.

## STOP 1 ruling (7 Oct 2026)

1. Keying the Altar section on the blessing's end instant: accepted.
2. The card's name column: accepted. The button stops repeating it and reads "Sacrifice · you have 1", or "Sacrifice · none in stock" when the floored stock is 0. The card's line stays "+3 morale · 2 seasons". Disabled rules and titles unchanged.
3. `until` as an ISO string in the effect_log detail: accepted.
4. No browser pass: the render tests cover the section, and I check it live after the deploy.
All other wording stands as rendered.

Two commits: first this ruling appended verbatim to docs/barracks/altar-prompt-1.md under its heading, then the button text in BarracksPanel.tsx with the render test's expected strings updated and no other assertion changed. Run the gate at the new HEAD, then the audit. STOP 2: a Committed line for each new commit, the gate's last line with suite counts, the audit exit code, and the two button texts as rendered. No push until I say push.
