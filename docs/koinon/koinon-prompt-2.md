# MASSALIA: Koinon, prompt 2: the treasury and the Lesche

Read `AGENTS.md` first. Pull `main` (baseline `6880e82`, or later if `docs/admin/admin-units-prompt-1.md` has landed: build on top of it). Commit locally only. Do not push. Web changes ship only with a render test.

## What this prompt builds

Each koinon gets a **treasury**. Any member gives drachmae into it, and nothing ever comes back out except spending on the koinon's buildings. The first building is the **Lesche**, the koinon's hall. The leader builds it from the treasury, it takes two days, and while it stands open the member cap rises from 8 to 12. It costs a daily upkeep from the treasury, settled lazily and closed-form. When the treasury cannot pay, the hall shuts until it can.

Server: one migration (five columns and a table), a pure settle function in shared, two routes, the settle wired into the koinon's locked paths, the purse sent to the city when a koinon ends. Client: a Treasury card and a Lesche card on the Koinon tab, one Chronicle line, two columns in the admin list.

Save this prompt as `docs/koinon/koinon-prompt-2.md` in the first commit.

## Facts from the repo (Phase 0 confirms; stop only on contradiction)

- Last migration is `0062_koina.sql`, so this prompt's is `0063_koinon_treasury.sql`. If admin-units-prompt-1 added one after all, take the next free number and say so.
- Content: `content/koinon/koinon.json`; schema and parser `koinonContentSchema` / `parseKoinonContent` in `packages/shared/src/koinon.ts:14` to 31; `KOINON_EVENTS` at 54 (`founded`, `joined`, `left`, `expelled`, `leader`).
- Service `apps/server/src/services/koinon.ts`:
  - `lockKoinon` (95), `seatCount` (102), `logKoinon` (127), `removeMember` (138), `dissolve` (155, deletes members, invites and posts, marks the row), `purgeInactive` (164), `sweepInactive` (182).
  - `withOwnKoinon` (200 to 211): one transaction, lock, purge, membership check, then `fn`. Every member write goes through it (467 to 656).
  - The cap is read as `c.memberCap` in `invite` (484), `acceptInvite` (536), the view's `koinon.cap` (380) and the `koina` list (396).
  - `KoinonView` type at 265 with `rules` at 267; `koinonView` at 331 (no koinon lock; it runs `sweepInactive` first).
  - `foundKoinon` (429) is the model for a wallet debit under `spendTransaction` with a later koinon write.
  - Admin: `AdminKoinonRow` (679), `adminKoinaList` (682), `adminDissolveKoinon` (728, calls `dissolve`).
- STOP 1 ruling 2 of prompt 1 (comment above `lockKoinon`): a player lock may be taken before a koinon lock, never after one.
- Wallet helpers: `spendTransaction`, `SpendRejected`, `debitDrachmae`, `creditWorldTreasury` in `services/buildings.ts` (245, 235, 271, 522).
- Routes `apps/server/src/routes/koinon.ts`: the POST helper at about 50, `GET /` at 72.
- Client: `apps/web/src/dashboard/panels/KoinonView.tsx`. `KoinonCard` (30) is the card; the member layout starts at about 290 (header card 293, take the lead 302, Board 312, Members 352, Invite 384, Soldiers 415, then Koina of the city and Leave); the leave text is built at 285 to 287.
- The build bar: `BuildProgress({ label, startedAt, completesAt, offset })` in `dashboard/shared.tsx:664`, with the offset taken once per payload as `Date.parse(payload.now) - Date.now()` (`LedgerPanel.tsx:554`).
- Chronicle renderer for `koinon`: `FamilyPanel.tsx:812`, a switch on `event`.
- Market precedent for money moves kept out of the Chronicle: `MarketTradeDetail` in `packages/shared/src/market.ts:27`, written as a plain `effect_log` row with no `chronicle` block, so the `/admin` character log shows it.
- Admin page: the Koina section at `AdminPage.tsx:297`; `loadKoina` at 134.

## Rulings

1. **The treasury.** An integer purse on the koinon, never below zero. Any member gives from 1 to 10,000 drachmae at a time from his own wallet. Nothing is ever withdrawn: the treasury only pays for the koinon's buildings and their upkeep. Gifts stay in the treasury when the giver leaves.
2. **Gifts are recorded, not chronicled.** Each gift is a row in `koinon_deposits` and a plain `effect_log` row of kind `koinon_deposit` on the giver's character (detail `{ koinonId, koinonName, amount, treasuryAfter }`, no `chronicle` block), as market trades are. Members see a list of givers with each one's total, and the 10 newest gifts.
3. **The Lesche.** One per koinon. Only the leader orders it. It costs 500 drachmae from the treasury, paid at the order, and stands 2 days later. No cancel, no refund. The order writes the leader's Chronicle line, event `lesche`.
4. **Upkeep.** From the moment the hall stands, it costs 5 drachmae a day from the treasury, paid at the start of each day. It is settled closed-form in whole days whenever the koinon's state is touched under its lock. The build cost and the upkeep are spent (they go nowhere).
5. **Open and shut.** The hall is open while its upkeep is paid. When the treasury cannot pay a day, the hall shuts at that moment. A shut hall owes nothing: no arrears build up while it is shut. It reopens at the first settle where the treasury holds a day's upkeep, which is paid at once.
6. **The cap.** While the hall is open the cap is 12, otherwise 8, for both invites and accepts. Under construction it is 8. When the hall shuts, nobody is expelled: members above 8 stay, and no one new joins until the count is below the cap that applies.
7. **When a koinon ends,** by its last member leaving or by an admin, the hall is settled first and whatever is left in the treasury goes to the world treasury (`creditWorldTreasury`). The admin audit detail records the amount.
8. **What others see.** The `koina` list shows each koinon's cap as it stands now (12 with an open hall). The treasury, the givers and the hall's state are for members only.
9. **Numbers live in content.** `content/koinon/koinon.json` gains:

```json
"deposit": { "max": 10000 },
"lesche": { "cost": 500, "buildDays": 2, "upkeepPerDay": 5, "memberCap": 12 }
```

The parser refuses a `lesche.memberCap` not above `memberCap`. The client reads every number from the `rules` block.

## The settle, exactly

A pure function in `packages/shared/src/koinon.ts`, DB-free and clock-free, used by both the locked write and the read-only view:

```ts
export type HallState = { completesAt: number | null; paidUntil: number | null; shut: boolean; treasury: number };
export type HallSettle = { state: HallState; spent: number; open: boolean; phase: "none" | "building" | "open" | "shut" };
export function settleHall(s: HallState, nowMs: number, upkeepPerDay: number): HallSettle;
```

With `DAY = 86_400_000`:

- `completesAt === null`: phase `none`, nothing spent.
- `nowMs < completesAt`: phase `building`, nothing spent.
- `shut` and `treasury >= upkeepPerDay`: reopen. Spend one day, `paidUntil = nowMs + DAY`, `shut = false`, phase `open`.
- `shut` otherwise: unchanged, phase `shut`.
- Open with `nowMs < paidUntil` (`paidUntil` starts at `completesAt`): nothing to pay, phase `open`.
- Open with `nowMs >= paidUntil`: `needed = floor((nowMs - paidUntil) / DAY) + 1`, `affordable = floor(treasury / upkeepPerDay)`.
  - `affordable >= needed`: spend `needed` days, `paidUntil += needed * DAY`, phase `open`.
  - Otherwise: spend `affordable` days, `paidUntil += affordable * DAY`, `shut = true`, phase `shut`.

`spent` is a whole number of days times `upkeepPerDay`; `state.treasury` is the treasury after it.

**Where it runs.** `settleHallLocked(tx, k, now)` applies it to a locked koinon row. The treasury debit is relative and guarded (`SET treasury = treasury - spent WHERE id = $1 AND treasury >= spent`), alongside `lesche_paid_until` and `lesche_shut`. It runs:

- in the body `withOwnKoinon` shares, after the purge;
- in `acceptInvite`, after the purge;
- inside `dissolve`, before the purse moves to the city.

**Gifts settle twice:** once before the credit and once after, so a hall that ran dry pays nothing for the days it stood shut, and reopens on the gift that refills it.

`markRead` stays unlocked and does not settle.

**The view never writes the hall.** `koinonView` derives the phase, the cap and the treasury it shows by calling `settleHall` on the stored row at `now`. This gives the same answer a locked settle would, because every change to the treasury settles first.

## Phase 0: recon

Confirm the facts above. Also report whether admin-units-prompt-1 is on `main`. **STOP 0 only on a contradiction.**

## Phase 1: rules, content, table

**Docs.** This prompt verbatim at `docs/koinon/koinon-prompt-2.md`.

**Shared** `packages/shared/src/koinon.ts`:

- the content schema gains `deposit` and `lesche` (ruling 9);
- `"lesche"` joins `KOINON_EVENTS`;
- `KoinonDepositDetail`;
- `HallState`, `HallSettle` and `settleHall` as above;
- `hallCap(phase, content)`, which returns `lesche.memberCap` for `open` and `memberCap` otherwise.

Unit tests:

- the parser refuses `lesche.memberCap` equal to `memberCap`;
- `settleHall`:
  - none and building;
  - the first day at the exact completion instant (needed 1);
  - 3 days unsettled with a full purse (needed 4, 20 spent);
  - 3 days unsettled with 12 in the purse (10 spent, `paidUntil` two days on, shut, 2 left);
  - shut with 2 stays shut;
  - shut with 5 reopens with one day paid and `paidUntil` a day from now;
- path independence: over a 10-day schedule with no gifts, settling every hour gives the same final state as settling once at the end.

**Content** `content/koinon/koinon.json` as ruling 9.

**Migration** `packages/db/migrations/0063_koinon_treasury.sql`, idempotent, one transaction:

```sql
ALTER TABLE koina ADD COLUMN IF NOT EXISTS treasury integer NOT NULL DEFAULT 0 CHECK (treasury >= 0);
ALTER TABLE koina ADD COLUMN IF NOT EXISTS lesche_started_at timestamptz;
ALTER TABLE koina ADD COLUMN IF NOT EXISTS lesche_completes_at timestamptz;
ALTER TABLE koina ADD COLUMN IF NOT EXISTS lesche_paid_until timestamptz;
ALTER TABLE koina ADD COLUMN IF NOT EXISTS lesche_shut boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS koinon_deposits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  koinon_id uuid NOT NULL REFERENCES koina(id),
  player_id uuid NOT NULL REFERENCES players(id),
  amount integer NOT NULL CHECK (amount > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS koinon_deposits_koinon_idx ON koinon_deposits (koinon_id, created_at DESC);
```

Drizzle schema in `packages/db/src/schema.ts` to match.

Gates: `pnpm -r lint`, shared and db builds, shared tests, the migration applied to a throwaway Postgres and to `massalia_test` twice (idempotence).

Commits: `docs: koinon prompt 2`, `shared: the koinon treasury and the Lesche settle`, `db: the koinon treasury, the Lesche and gifts`.

## Phase 2: server

In `services/koinon.ts`:

- **The shared locked body.** Factor the body of `withOwnKoinon` into `inOwnKoinon(tx, ctx, now, fn)`, which locks, purges, settles the hall, checks membership and runs `fn`. `withOwnKoinon` becomes a transaction around it. No behaviour change for the existing callers beyond the settle.
- **`settleHallLocked(tx, k, now)`,** as above. It returns the updated row and the `HallSettle`.
- **`giveToKoinon(ctx, amount, now)`,** inside `spendTransaction(giver)` (player lock first, then `inOwnKoinon`).
  - Refusals: 400 for an amount that is not a whole number from 1 to `deposit.max`; 403 for a non-member.
  - The sequence is settle, then the guarded wallet debit, then the treasury credit (`treasury = treasury + amount`), then settle again.
  - A short wallet throws `SpendRejected` 402 `You hold only {n} drachmae.`, so nothing is written.
  - Then the `koinon_deposits` row and the `koinon_deposit` effect_log row.
  - Returns `{ ok, wallet, treasury }`.
- **`buildLesche(ctx, now)`** through `withOwnKoinon`, after the settle.
  - Refusals: 403 for anyone but the leader; 409 when the hall already exists or is building; 409 `The treasury holds {n} drachmae. The Lesche costs {cost}.` when short.
  - Otherwise: guarded treasury debit of `lesche.cost`, then `lesche_started_at = now`, `lesche_completes_at = now + buildDays days`, `lesche_paid_until = lesche_completes_at`, `lesche_shut = false`, then the Chronicle line `lesche` on the leader.
  - Returns `{ ok, completesAt, treasury }`.
- **The cap.** `invite` and `acceptInvite` use `hallCap(settle.phase, c)` from the settle they just ran, in place of `c.memberCap`. The refusal wording keeps its number from the cap in force.
- **`dissolve`.** It settles the hall, then credits the remaining treasury to the world treasury and sets `treasury = 0`, before the existing deletes.
  - `adminDissolveKoinon`'s audit detail gains `treasuryToCity`.
  - `removeMember`, the purge and the sweep reach `dissolve` unchanged.
- **The view** (read-only, ruling 8 and "The view never writes the hall"):
  - `rules` gains `depositMax`, `lescheCost`, `lescheBuildDays`, `lescheUpkeep`, `lescheCap`.
  - The `koinon` block gains `treasury`, `hall: { phase, startedAt, completesAt, paidUntil, daysCovered }`, `givers: [{ playerId, name, total }]` (every giver to this koinon, by total descending, then name) and `gifts: [{ id, name, amount, label }]` (the 10 newest).
  - `daysCovered` is `floor(treasury / upkeep)` for an open hall and 0 otherwise.
  - `cap` comes from `hallCap`.
  - The `koina` list computes each koinon's cap the same way, from its stored row.
- **Admin.** `AdminKoinonRow` gains `treasury` and `hall` (the phase), both derived read-only.

**Routes** in `routes/koinon.ts`: `POST /give` `{ amount }` and `POST /lesche`. Codes as above.

### Tests

`services/koinon.test.ts`, DB-gated:

- **Give.**
  - A member gives 30: wallet down 30, treasury up 30, one `koinon_deposits` row, one `koinon_deposit` effect_log row with no `chronicle` key.
  - A non-member gets 403.
  - 0, 1.5 and 10,001 are each 400.
  - A short wallet is 402 with nothing written.
  - A gift to a hall shut for three days with an empty treasury, of 50: the treasury ends at 45 (nothing paid for the shut days, one day paid on reopening) and the hall is open.
- **Build.**
  - The vice gets 403.
  - A treasury of 499 is 409.
  - Success: treasury down 500, the three timestamps 2 days apart as ruled, the `lesche` line on the leader.
  - A second build is 409.
- **Cap.**
  - While building, a 9th seat is refused.
  - Once it stands with a funded treasury, invites and accepts run to 12, and the 13th is refused.
  - With the treasury empty a day after `paid_until`, the hall is shut: the 12 members stay, and an invite and an accept are both refused.
- **Upkeep through a write.** A post 3 days after completion with 100 in the treasury leaves 80.
- **Dissolve.**
  - The last member leaving a koinon with 37 in the treasury and an open hall paid through now: the world treasury rises by 37 less the upkeep due, and `koina.treasury` is 0.
  - An admin dissolve does the same, with `treasuryToCity` in the audit row.
- **View.**
  - Treasury, phase, `daysCovered`, givers' totals and the 10 newest gifts.
  - A non-member's `koina` list shows cap 12 for a koinon with an open hall, and the koina row is byte-identical before and after the read.
- **Routes.** `app.inject()` smoke for `/give` and `/lesche`, 401 without a session.

Gates: `pnpm -r lint`, server tsc, the server, db and shared suites against a migrated `massalia_test`.

Commits: `koinon: the hall settle under the koinon lock`, `koinon: gifts to the treasury`, `koinon: the Lesche and its cap`, `koinon: the treasury goes to the city when a koinon ends`, `koinon: treasury and Lesche tests`.

**STOP 1.** Paste `settleHall`, `giveToKoinon` in full, and `dissolve` as it now stands. Wait.

## Phase 3: Chronicle, client, admin

**Chronicle.** The `lesche` event in the `koinon` renderer (`FamilyPanel.tsx:812`): `Commissioned a Lesche for the koinon {koinonName}.` Add it to `chronicle-entry.test.tsx`.

**`api.ts`.** The new view fields and rules, `api.koinonGive(amount)`, `api.koinonBuildLesche()`, and the two admin columns.

**`KoinonView.tsx`,** member layout, two new cards between Board and Members, in the same pottery look.

**Treasury** card, with note `{treasury} drachmae`:

- the line `Members give drachmae to the koinon. Nothing comes back out: the treasury pays only for the koinon's buildings.`;
- a whole-number input clamped to 1..min(`depositMax`, wallet) and `Give`;
- **Givers**: `{name} · {total}`;
- **Recent gifts**: `{name} gave {amount} · {label}`;
- `No gifts yet.` when empty.

**Lesche** card, by phase:

- `none`: `A hall for the koinon. While it stands open the koinon holds up to {lescheCap} members. It costs {lescheCost} drachmae from the treasury, takes {lescheBuildDays} days to build, and {lescheUpkeep} drachmae a day to keep.`
  - For the leader, add `Build the Lesche · {lescheCost}`. It is disabled with `The treasury holds {treasury} drachmae.` when short.
  - Other members see the text only.
- `building`: `BuildProgress` with the label `Building the Lesche`, `startedAt`, `completesAt` and the payload's offset.
- `open`: `Open. Up to {lescheCap} members. Upkeep {lescheUpkeep} drachmae a day; the treasury covers {daysCovered} more days.`
- `shut`: `Shut: the treasury could not pay its upkeep. No one new joins past {memberCap} until it reopens. It reopens when the treasury holds {lescheUpkeep} drachmae.`

**Two existing lines change:**

- The header and Members notes already read `{n} of {cap}` and pick up the new cap with no change.
- The leave text for the last member becomes `No one is left to take it: the koinon ends, and its treasury of {treasury} drachmae goes to the city.`

**Admin page.** The Koina list gains `Treasury` and `Lesche` (the phase). The dissolve confirm gains ` Its treasury of {treasury} drachmae goes to the city.`

### Render tests

- `koinon-view.test.tsx`:
  - a member sees the Treasury card with Give, the givers and the gifts;
  - phase `none`: the leader sees Build disabled with the reason at treasury 499 and enabled at 500, and a plain member sees no Build;
  - `building` shows the build bar;
  - `open` shows the covered-days line and the header reads `9 of 12`;
  - `shut` shows the reopen line;
  - the last member's leave confirm names the treasury;
  - no hook-order warning across renders.
- `admin-koina.test.tsx`: the two columns render.

Gates: `pnpm -r lint`, web tsc, web build, web tests, then the full `pnpm gate` at HEAD.

Commits: `chronicle: the Lesche line`, `web: the treasury and the Lesche on the Koinon tab`, `web: treasury and Lesche in the admin koina list`.

**STOP 2.** Final report with captures at desktop width and at 390px of the Treasury and Lesche cards in each phase (none as leader, building, open, shut). Wait. Do not push.

## Scope fence

Touch only:

- `docs/koinon/koinon-prompt-2.md`;
- `content/koinon/koinon.json`;
- `packages/shared/src/koinon.ts` and its test;
- `packages/db/migrations/0063_koinon_treasury.sql`, `packages/db/src/schema.ts`;
- `apps/server/src/services/koinon.ts`, `routes/koinon.ts`, `routes/admin.ts` (the koina list and dissolve detail only), and their tests;
- `apps/web/src/api.ts`, `dashboard/panels/KoinonView.tsx`, `dashboard/panels/FamilyPanel.tsx` (the `lesche` case only), `AdminPage.tsx` (the Koina section only), `dashboard/dashboard.css` (`koinon-*` classes), `apps/web/test/`.

Nothing else. In particular:

- No change to `buildings.ts` beyond calling its exported helpers.
- No change to the player economy, the Barracks, the map, parties, `/me/state` or `apps/web/public/**`.
- No other koinon building, no withdrawals, no treasury spending besides the Lesche, no musters, no map notes.

Player-facing copy beyond what is quoted here is new copy: list every string in the report.

## Final report template

As koinon prompt 1's, plus:

```
TREASURY AND LESCHE
baseline: <SHA> (admin-units-prompt-1 on main: yes/no)
migration 0063 applied: throwaway / massalia_test, idempotent rerun clean
settleHall path independence: hourly vs once over 10 days, identical
gift to a shut hall: treasury before / after, phase after
dissolve: treasury to the city, world treasury before / after
view read-only check: koina row before/after identical
captures: desktop and 390px, the four phases
NEW PLAYER-FACING COPY: every string not quoted in this prompt, server errors included
RULINGS FOR ARGIRIS: every departure from this prompt, with the reason
Committed: <SHA> <subject>, one line per commit, in order
GATE: the gate's last line at HEAD
```

## STOP 1 ruling

STOP 1 ruling (koinon prompt 2)

Append this ruling verbatim at the end of docs/koinon/koinon-prompt-2.md under "## STOP 1 ruling", as its own commit `docs: koinon prompt 2 STOP 1 ruling`, then go on to Phase 3.

1. Copy fix, one commit `koinon: a shut Lesche says why the koinon is full`. When the hall's phase is `shut`, the invite refusal reads "The Lesche is shut, so the koinon takes no one new past {memberCap}." In every other case the existing sentence stands, with the number from the cap in force. The accept refusal "That koinon is full." is unchanged. Add the shut case to the cap test.
2. Accepted. dissolve returns the row and treasuryToCity.
3. Accepted. Gift rows stay when a koinon is dissolved, as the record.
4. Accepted. A no-op settle writes nothing, and a guarded debit that misses under the lock throws.
5. Accepted. inOwnKoinon reads the caller's membership inside the transaction.
6. Accepted. The amount is checked first (400), then membership (403).
7. Accepted, both 409s and all four new strings as written.
8. Accepted. The admin columns stay in the Lesche commit, and adminKoinaList takes now. Phase 3's client commit for the admin list stays as planned.
9. Accepted. The amend stands, since ffd4720 is the last commit and nothing follows it. From here on, read every test command's exit code directly before committing (AGENTS.md, commit discipline). A commit made on a red run is a deviation to report, even when it is fixed before the report.
10. Accepted. HallPhase is exported.

Phase 3 goes ahead as written. Run the full `pnpm gate` at HEAD before STOP 2. Captures as named at STOP 2. Do not push.

## STOP 2 ruling

STOP 2 ruling (koinon prompt 2)

Append this ruling verbatim at the end of docs/koinon/koinon-prompt-2.md under "## STOP 2 ruling", as its own commit `docs: koinon prompt 2 STOP 2 ruling`.

Accepted as reported: the build confirm and its copy; the plural fixes; Give disabled with no reason line on an empty wallet; the 3-member captures; the 1x captures; the admin column showing the phase word as stored; the field label.

Item 2, the one-shot read when the Lesche stands: confirm three things in the report.
(a) It is armed from the payload's server clock (onDeviceClock(completesAt, offset) with the offset from the payload's `now`), never from Date.now() alone.
(b) It is cleared on unmount and on every new payload.
(c) It cannot fire again when the payload that comes back still says `building`; it re-arms only from that payload's own `now`.
If any of the three does not hold, fix it in one commit `web: the Lesche read is armed from the server clock`, with a render test case for a device clock 10 minutes ahead of the server.

Then the full `pnpm gate` at HEAD. If it ends GATE GREEN at HEAD, tree clean, push without a further STOP:
- plain `git push`, fast-forward only;
- report remote HEAD, the CI run with its Gate step on postgres:16 and its suite counts, the Railway server deploy with migration 0063 confirmed by a read of __massalia_migrations through `railway run --service Postgres --environment production` (read only), the Railway worker deploy, the Pages run, /health, and GET /api/koinon answering 401 without a session;
- stop the throwaway Postgres on 5433 after the report.

If the gate is red, STOP with the log. A red caused only by a timeout in a suite this work does not touch is still a STOP, not a rerun.

Report every new commit as `Committed: <SHA> <subject>` and quote the gate's last line.
