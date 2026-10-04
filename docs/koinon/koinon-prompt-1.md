# MASSALIA: Koinon, prompt 1: the koinon itself

Read `AGENTS.md` first. Pull `main` (baseline `342827c`, or later if `docs/admin/admin-units-prompt-1.md` has landed: build on top of it). Commit locally only. Do not push. Web changes ship only with a render test.

## What this prompt builds

A player-made company of citizens, the **koinon** (plural **koina**), with its own third tab in the Politics panel. A free citizen with prestige 20 and 50 drachmae founds one. The leader and the vice leader invite other players by name, up to 8 members. Members see the leader, the vice and the member list. The leader and the vice post short messages to a board the members read. The leader sees every member's soldiers, live and read-only. Leaving or expulsion carries a one-season cooldown. An absent leader can be replaced by the vice after five days. Admins can rename and dissolve a koinon.

No military actions, no treasury, no buildings, no map notes in this prompt. Those are later prompts.

Server: four tables and a column, one content file, one service, fifteen routes, one Chronicle kind, a count in `/me/state`, three admin routes. Client: the Koinon tab, the Politics nav count, an admin section.

Save this prompt as `docs/koinon/koinon-prompt-1.md` in the first commit.

## Facts from the repo (Phase 0 confirms; stop only on contradiction)

- Last migration is `0061_resources_unique.sql`, so this prompt's migration is `0062_koina.sql`. If admin-units-prompt-1 added a migration after all, take the next free number and say so.
- Politics panel: `apps/web/src/dashboard/panels/PoliticsPanel.tsx`. `export default function PoliticsPanel({ player, onRefresh }: PanelProps)` at 807, tab state at 808 (`useState<"council" | "party" | "cities" | "diplomacy">`), `locked` at 814 (`player.professionSlug === "slave"`: the whole panel is closed to slaves), the pottery tab row `cs-tabs pottery` at 850 to 863, the body chain at 865 to 877 (`CitiesView` and `DiplomacyView` are imported sibling views at lines 6 and 7: the model for a new `KoinonView`). The council card pattern is `DashboardCard className="chamber-card"` with `<div className="meander" aria-hidden="true" />` bands (286, 327).
- `apps/web/test/politics-chamber.test.tsx:113` asserts four `.cs-tab` buttons; `:132` asserts no emoji in the tab row.
- Nav counts: `apps/web/src/dashboard/Dashboard.tsx`. The Family count is `player.familyPending`, drawn at 357 (desktop) and 434 (mobile primary). Politics sits in `mobileMoreNav` (43 to 45); the More button's dot is `hiddenBadgeCount` (187), which sums a static `item.badge` that is never set, and the More sheet draws `item.badge` (462). `PlayerDashboardState` is in `dashboard/shared.tsx:17` (`familyPending` at 62, mapped in `playerFromState` at 127); the client state type has `familyPending` at `api.ts:227`; the placeholder state is `Dashboard.tsx:82`.
- `/me/state` is `apps/server/src/routes/me.ts`: `familyPendingCount(character)` at 111 is the lean-count model; the payload field is at 239.
- Route pattern: the `acting()` helper in `apps/server/src/routes/market.ts:12` to 21 and its UUID guard at 8. Routes register in `apps/server/src/index.ts` (market at 150, admin at 151). Content loaders run at boot at 95 to 121 (`loadNewsContent` at 111 is the simplest model; `/content/*.json` is served publicly by `fastify-static`, which is fine here: the koinon file holds no military numbers).
- Wallet and treasury: `spendTransaction` (245), `SpendRejected` (235), `debitDrachmae` (271), `creditWorldTreasury` (522), all in `apps/server/src/services/buildings.ts`; `ActingContext` (153). Lock: `lockPlayer` in `services/lock.ts:34`.
- Character rows: `findCharacterRow(playerId, worldId, exec)` in `services/character.ts:82`. Prestige is `player_characters.prestige`; a slave is `player_characters.class_id = 'slave'` (the party join's guard, `services/politics.ts:42`). Portrait: `agedPortraitFor(character, nowMs)` in `services/age.ts:47` (the market seller row uses it at `services/market.ts:110`).
- Names: `sanitizeDisplayName` and `hasLetter` in `packages/shared/src/names.ts:16`, `:23`; `admin.ts` imports both and `nameTaken` from `services/playerNames.ts:11`.
- Succession reuses the `players` row (the `successions` comment, `schema.ts:196`), so anything keyed on `players.id` passes to the heir. Account deletion sets `players.is_active = false` on every world (`services/account.ts:26`).
- Daily hand: `daily_decisions` (`schema.ts:338`) has `character_id`, `utc_day`, `created_at`; the dashboard deals the day's set on every load (`Dashboard.tsx:223`, `api.dailyEvents()`), so the newest `created_at` of a character is the last day its player opened the game.
- Soldiers: `player_units` (`schema.ts:849`: `owner_player_id`, `source` trained|band, `unit_id`, `count`, `ready_at`, `contract_end_at`, `based_at`, `moving_to`, `arrives_at`, `mission`), `player_levy` (`men`, `last_growth_season`, `schema.ts:911`), ships are the `trade-ship` and `galley` rows of `resources` (scope `player`). `barracksView` (`services/barracks.ts:872`) settles and must not be called for another player; its place naming (`townDisplayName` / `regionDisplayName`, 911) and its row fields are the model. `ensureLevy` (236) shows the levy growth step.
- Chronicle: `ChronicleType` (`packages/shared/src/chronicle.ts:24`), `ChronicleEffectLogKind` and `CHRONICLE_EFFECT_LOG_KINDS` (164 to 170), `TYPE_ORDER` (323; 18 and 19 are free since the market lines were removed), the staging loop in `buildChronicle` (around 395 to 432; `story_line` is the latest precedent of an effect_log kind with its own row type); the db reader in `packages/db/src/chronicle.ts:247` to 278; renderers `chronicleRenderers` in `apps/web/src/dashboard/panels/FamilyPanel.tsx:766`; client union `apps/web/src/api.ts:278`. `effect_log.character_id` references `player_characters.id`.
- Admin: `apps/server/src/routes/admin.ts` (`requireAdmin`, `audit(exec, adminUserId, action, targetUserId, detail)` at 36, the ban route at 226 is the model); `apps/web/src/AdminPage.tsx` (`act()` at about 60, sections at 163, 253, 273); `apps/web/test/admin-verify.test.tsx` is the test model.
- Tests: server suites gate on `describe.runIf(dbUrl.includes("_test"))` and seed their own world and players (`services/market.test.ts:13` to 60 is the model); web render tests are `// @vitest-environment jsdom` files in `apps/web/test/`.

## Rulings

1. **Tab.** A Politics tab, third in the row: Oligarchy Council, Your Party, Koinon, Cities, Diplomacy. Tab id `koinon`, label `Koinon`, followed by the pending count when it is above zero (a number, no emoji). Slaves never see it (the panel is already locked to them).
2. **Founding.** A free citizen who is not in a koinon and not under cooldown founds one with prestige of at least 20 (checked, not spent) and 50 drachmae (guarded debit, paid into the world treasury through `creditWorldTreasury`). The founder becomes the leader. The name is `sanitizeDisplayName` output of 3 to 32 characters with at least one letter (`hasLetter`), unique within the world ignoring case among koina that are not dissolved, and fixed after founding (only an admin renames).
3. **Cap.** 8 members, the leader included.
4. **Roles.** One leader and at most one vice, named by the leader from the members.
   - Leader: invite, withdraw an invite, expel, name or clear the vice, hand over the lead, post, delete any post, see the soldiers.
   - Vice: invite, withdraw an invite, post, delete his own posts.
   - Member: read the board, leave.
5. **Invites.** By a player's exact name (ignoring case) in the active world. Refused when the name is unknown (404), the player is a slave or already in a koinon (409), this koinon already has a pending invite for him (409), or members plus unexpired pending invites already reach the cap (409). An invite stands 48 hours. The invitee accepts or declines; an accept is refused under cooldown (409) or when the koinon is full (409), and on success deletes every other invite of that player. The leader or the vice can withdraw a pending invite.
6. **Leaving and expulsion.** A member leaves at any time. Leaving or being expelled sets `players.koinon_cooldown_until` to now plus 24 hours; until then the player can neither accept an invite nor found. The leader cannot expel himself.
7. **The lead passes.** When the leader leaves, the vice becomes leader; with no vice, the longest-standing member does (earliest `joined_at`, then player id). When the vice leaves or is expelled, the vice seat empties. When the last member leaves, the koinon is dissolved: `dissolved_at` set, invites and posts deleted, the name free again. Players get no dissolve button.
8. **Absent leader.** When the leader has led for at least 5 days (`leader_since`) and his current character has had no daily hand dealt in the last 5 days (the newest `daily_decisions.created_at`), the vice may take the lead; with no vice, the longest-standing member other than the leader may. The old leader stays as a member. `leader_since` resets on every change of leader.
9. **Heirs and deleted accounts.** Membership is keyed on `players.id`, so an heir keeps it and nothing runs at succession. A member whose `players.is_active` is false is removed on the next read or write of his koinon, as if he had left (the lead passes by ruling 7), with no cooldown and no Chronicle line.
10. **Board.** The leader and the vice post messages of up to 300 characters (`sanitizeDisplayName`-style cleaning with a 300 cap: invisibles stripped, whitespace collapsed, so a post is one paragraph). Members read them, newest first, with author and game date. The koinon keeps its newest 20 posts; older ones are deleted in the posting transaction. An author deletes his own post; the leader deletes any. Posts never appear in `/admin`.
11. **Pending count.** `/me/state` carries `koinonPending`: for a member, the posts by other players newer than his `last_read_at`; for a non-member, his unexpired invites. It is shown on the Politics nav (desktop, the mobile More dot and the More sheet) and on the Koinon tab. When the tab loads with unread posts, it calls `POST /api/koinon/read` and then `onRefresh()`.
12. **The leader sees the soldiers.** `GET /api/koinon/armies`, leader only (403 for anyone else, the vice included): every member's soldiers, levy and fleet, live and read-only. It never settles another player and writes nothing. State is derived at read time:
    - a row whose `arrives_at` has passed stands at `moving_to`, at home;
    - a trained row whose `ready_at` has passed is trained;
    - a band whose `contract_end_at` has passed is left out;
    - the levy is `men` plus the whole years of base growth since `last_growth_season` (`ensureLevy`'s step, base growth only; a member with no levy row shows what `ensureLevy` would insert);
    - the fleet is the floored `trade-ship` and `galley` stock, labelled Pentekonter and Trireme.

    A row disbanded for unpaid upkeep stays visible until that member next opens the game; that gap is accepted.
13. **Chronicle.** One kind, `koinon`, written on the player's own current character with `detail.chronicle = { event, koinonName }`, `event` one of `founded`, `joined`, `left`, `expelled`, `leader` (the new leader, however the lead came to him). Admin renames and dissolves write no line.
14. **What others see.** Every player sees each live koinon's name, leader and member count. The member list, the board and the pending invites are for members only; the soldiers are for the leader only.
15. **Admin.** `/admin` lists the active world's koina (name, leader, members, founded) with Rename and Dissolve, each with a reason, each audited. An admin dissolve removes every member with no cooldown and no Chronicle line. Admin sees no posts.
16. **Numbers live in content.** `content/koinon/koinon.json`:

```json
{
  "foundCost": 50,
  "foundPrestige": 20,
  "memberCap": 8,
  "inviteHours": 48,
  "cooldownHours": 24,
  "absentLeaderDays": 5,
  "name": { "min": 3, "max": 32 },
  "post": { "maxChars": 300, "kept": 20 }
}
```

The client reads the numbers from the `rules` block of `GET /api/koinon`; no player-facing string hardcodes them.

## Phase 0: recon

Confirm the facts above. Also report: whether admin-units-prompt-1 is on `main` and where its admin code sits, the function `/admin` already uses to name a player's house, and how `BarracksPanel.tsx` turns a unit's `icon` into an image path. **STOP 0 only on a contradiction.**

## Phase 1: rules, content, tables

**Docs.** This prompt verbatim at `docs/koinon/koinon-prompt-1.md`.

**Shared** `packages/shared/src/koinon.ts`, exported from the package index: `KoinonContent` type, `parseKoinonContent(raw)` (zod, every number a positive integer, `name.min <= name.max`), `cleanKoinonName(raw, content)` returning the cleaned name or null, `cleanKoinonPost(raw, content)` returning the cleaned body or null, `KOINON_EVENTS` and its type. Unit tests: the parser rejects a missing or non-positive field; names of 2, 3, 32 and 33 characters, digits only, invisibles inside; a post of 301 characters and one of newlines only.

**Content** `content/koinon/koinon.json` as in ruling 16; server loader `loadKoinonContent()` / `getKoinonContent()` in the new service, called at boot next to `loadNewsContent()`.

**Migration** `packages/db/migrations/0062_koina.sql`, idempotent, one transaction:

```sql
CREATE TABLE IF NOT EXISTS koina (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id uuid NOT NULL REFERENCES worlds(id),
  name text NOT NULL,
  leader_player_id uuid REFERENCES players(id),
  vice_player_id uuid REFERENCES players(id),
  leader_since timestamptz NOT NULL DEFAULT now(),
  founded_at timestamptz NOT NULL DEFAULT now(),
  dissolved_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS koina_live_name_idx ON koina (world_id, lower(name)) WHERE dissolved_at IS NULL;

CREATE TABLE IF NOT EXISTS koinon_members (
  world_id uuid NOT NULL REFERENCES worlds(id),
  player_id uuid NOT NULL REFERENCES players(id),
  koinon_id uuid NOT NULL REFERENCES koina(id),
  joined_at timestamptz NOT NULL DEFAULT now(),
  last_read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (world_id, player_id)
);
CREATE INDEX IF NOT EXISTS koinon_members_koinon_idx ON koinon_members (koinon_id);

CREATE TABLE IF NOT EXISTS koinon_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id uuid NOT NULL REFERENCES worlds(id),
  koinon_id uuid NOT NULL REFERENCES koina(id),
  player_id uuid NOT NULL REFERENCES players(id),
  inviter_player_id uuid NOT NULL REFERENCES players(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  UNIQUE (koinon_id, player_id)
);
CREATE INDEX IF NOT EXISTS koinon_invites_player_idx ON koinon_invites (player_id);

CREATE TABLE IF NOT EXISTS koinon_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  koinon_id uuid NOT NULL REFERENCES koina(id),
  author_player_id uuid NOT NULL REFERENCES players(id),
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS koinon_posts_koinon_idx ON koinon_posts (koinon_id, created_at DESC);

ALTER TABLE players ADD COLUMN IF NOT EXISTS koinon_cooldown_until timestamptz;
```

The primary key on `koinon_members (world_id, player_id)` is what keeps a player in one koinon at a time. An expired invite blocks a re-invite through the unique pair, so the invite path deletes the pair's expired row first. Drizzle schema in `packages/db/src/schema.ts` beside the other tables; the expression index lives only in SQL, as the players' name index does.

Gates: `pnpm -r lint`, shared and db builds, shared tests, the migration applied to a throwaway Postgres and to `massalia_test` twice (idempotence).

Commits: `docs: koinon prompt 1`, `shared: koinon rules and content`, `db: koina, members, invites and posts`.

## Phase 2: server

**Service** `apps/server/src/services/koinon.ts`.

Concurrency: every write that changes a koinon's membership, roles, invites or posts runs in one transaction that first locks the koinon row (`SELECT … FROM koina WHERE id = $1 AND dissolved_at IS NULL FOR UPDATE`; a missing row is 404). Founding runs in `spendTransaction(founder)` (the wallet invariant). Removing inactive members (ruling 9) happens under the same koinon lock, at the start of every read and write of that koinon. Every Chronicle line is an `effect_log` row on `findCharacterRow(playerId, worldId, tx)`.

Functions, each returning the route's result or `{ error, code }`:

- `koinonView(ctx, now)`: the page payload below.
- `foundKoinon(ctx, name, now)`: ruling 2; 403 for a slave, 403 below the prestige, 409 in a koinon or under cooldown, 400 a bad name, 409 a taken name, 402 a short purse (throw `SpendRejected` so nothing is written). On success: debit, treasury credit, koina row, member row, delete the founder's invites, Chronicle `founded`.
- `invite(ctx, name, now)`, `withdrawInvite(ctx, inviteId)`, `acceptInvite(ctx, inviteId, now)`, `declineInvite(ctx, inviteId)`: ruling 5. Accept writes Chronicle `joined`.
- `leave(ctx, now)`: rulings 6 and 7; Chronicle `left` on the leaver and `leader` on a new leader.
- `expel(ctx, playerId, now)`: leader only; cooldown; Chronicle `expelled`.
- `setVice(ctx, playerId | null)`: leader only; the target must be a member other than the leader.
- `handOver(ctx, playerId, now)`: leader only; the target becomes leader (and leaves the vice seat if he held it), `leader_since` resets, Chronicle `leader`.
- `takeLead(ctx, now)`: ruling 8; 403 for anyone not entitled, 409 while the leader is not yet absent; Chronicle `leader`.
- `post(ctx, body, now)`, `deletePost(ctx, postId)`: ruling 10.
- `markRead(ctx, now)`: stamps the caller's `last_read_at`.
- `koinonPendingCount(playerId, worldId, now)`: ruling 11, two lean count queries, nothing else.
- `memberArmies(ctx, now)`: ruling 12, read-only. Put the per-row derivation in an exported pure function `deriveArmyRow(row, now)` so it can be unit tested.

Page payload of `GET /api/koinon`:

```
{
  now,
  rules: { foundCost, foundPrestige, memberCap, nameMin, nameMax, postMaxChars, cooldownHours },
  me: { playerId, role: "leader" | "vice" | "member" | null, cooldownUntil, prestige, drachmae },
  koina: [{ id, name, leaderName, members, cap }],
  invites: [{ id, koinonId, koinonName, inviterName, expiresAt }],
  koinon: null | {
    id, name, foundedLabel, cap, leaderPlayerId, vicePlayerId, leaderAbsent, canTakeLead,
    members: [{ playerId, name, houseSlug, houseName, professionSlug, faceId, portrait, party, joinedLabel, role }],
    pending: [{ id, playerName, expiresAt }],
    posts: [{ id, authorName, body, label, canDelete }],
    unread
  }
}
```

`koina` lists every live koinon of the world, sorted by name. `invites` holds the caller's unexpired invites and is empty for a member. `pending` is filled for the leader and the vice only. Labels are `formatGameDate(gameDate(ms, worldStartedMs))`. Members are sorted leader, vice, then `joined_at`.

Payload of `GET /api/koinon/armies`:

```
{
  now,
  members: [{
    playerId, name,
    levy, fleet: { pentekonters, triremes },
    home: [{ placeId, placeName, rows: [ArmyRow] }],
    away: [ArmyRow & { missionKind, targetName, arrivesAt }],
    training: [ArmyRow & { readyAt }]
  }]
}
ArmyRow = { unitId, label, plural, icon, source, count }
```

Home places are ordered Massalia first, then the rest by name, the order the Barracks At Home list uses.

**Routes** `apps/server/src/routes/koinon.ts` at `/api/koinon`, the `acting()` helper and UUID guard copied from `routes/market.ts`:

- `GET /` and `GET /armies`
- `POST /found` `{ name }`, `/invite` `{ name }`, `/withdraw` `{ inviteId }`, `/accept` `{ inviteId }`, `/decline` `{ inviteId }`
- `POST /leave`, `/expel` `{ playerId }`, `/vice` `{ playerId | null }`, `/handover` `{ playerId }`, `/take-lead`
- `POST /post` `{ body }`, `/post/delete` `{ postId }`, `/read`

Codes: 400 validation or a malformed id, 402 short purse, 403 role or requirement, 404 unknown koinon, invite, post or player name, 409 conflicts. Error messages are player-facing copy (see Phase 4) and go in the report.

### Tests

`apps/server/src/services/koinon.test.ts`, DB-gated, seeding its own world and players:

- found: refused for a slave, at prestige 19, with 49 drachmae, under cooldown, in a koinon, with a bad name, with a taken name in another case; on success the wallet drops by 50, the world treasury rises by 50, the founder leads, a `koinon` / `founded` effect_log row exists.
- invite: the leader and the vice can, a member gets 403; unknown name 404; slave, member of another koinon, duplicate pending 409; with 6 members and 2 pending invites a third invite is 409; an expired invite does not block a re-invite.
- accept: refused when expired, under cooldown, or full; success deletes the player's other invites; race: two invites for the last seat written directly (bypassing the invite rule), two `acceptInvite` calls under `Promise.all`, exactly one succeeds, 10 runs. Same player accepting two koina at once: exactly one membership.
- leave and the lead: a member leaving gets the cooldown; the leader leaving hands the lead to the vice, with no vice to the longest-standing member; the last member leaving dissolves the koinon and frees the name.
- expel: leader only; the leader cannot expel himself; the expelled player gets the cooldown and the line.
- vice and hand over: vice set and cleared; hand over makes the vice the leader and empties the vice seat; `leader_since` resets.
- take the lead: 409 at 4 days of absence, allowed at 5 for the vice; with no vice, allowed for the longest-standing member and 403 for another member; a leader of 2 days whose character has no daily rows is not absent.
- deleted account: a member with `is_active = false` is gone from the next view; when he was the leader, the lead has passed.
- board: a member gets 403; 301 characters is 400; the 21st post deletes the oldest; the author deletes his own; the leader deletes the vice's; the vice cannot delete the leader's.
- pending count: a member's count counts other players' posts after `last_read_at` and not his own; `markRead` zeroes it; a non-member's count is his unexpired invites.
- armies: the vice gets 403; a row past `arrives_at` shows at its destination at home; a trained row past `ready_at` shows trained; a band past `contract_end_at` is absent; the levy projects whole years only; no row of `player_units`, `player_levy` or `resources` changes (compare before and after). `deriveArmyRow` unit cases for each state.
- routes: `app.inject()` smoke for every endpoint with a minted session, 401 without.

Gates: `pnpm -r lint`, server tsc, the server, db and shared suites against a migrated `massalia_test`.

Commits: `koinon: service and routes`, `koinon: the leader's view of the members' soldiers`, `koinon: service and route tests`.

**STOP 1.** Paste `acceptInvite` in full, the koinon lock and seat-count SQL, and `deriveArmyRow`. Wait.

## Phase 3: Chronicle, the pending count, admin

**Chronicle.** The `koinon` kind in the five places AGENTS.md names, with its own row type and input field on the `story_line` model: the `ChronicleType` union, `TYPE_ORDER` (`koinon: 18`), `ChronicleEffectLogKind` and `CHRONICLE_EFFECT_LOG_KINDS`, the staging loop, the db reader branch, the `FamilyPanel.tsx` renderer, the client union in `api.ts`. Renderer lines:

- `founded`: `Founded the koinon {koinonName}.`
- `joined`: `Joined the koinon {koinonName}.`
- `left`: `Left the koinon {koinonName}.`
- `expelled`: `Was expelled from the koinon {koinonName}.`
- `leader`: `Took the lead of the koinon {koinonName}.`

Tests: a shared `buildChronicle` case, a db reader case, the five lines in `apps/web/test/chronicle-entry.test.tsx`.

**Pending count.** `koinonPending` in the `/me/state` payload beside `familyPending` (`koinonPendingCount`, no other work in that route).

**Admin** in `routes/admin.ts`:

- `GET /admin/koina`: the active world's live koina with id, name, leader name, member count, `founded_at`.
- `POST /admin/koina/:id/rename` `{ name, reason }`: same cleaning and uniqueness as founding, under the koinon lock; audit `koina.rename` with the old and new names.
- `POST /admin/koina/:id/dissolve` `{ reason }`: ruling 15; audit `koina.dissolve` with the name and the member ids.

Admin route tests in `routes/admin.test.ts` on the existing model: 401 or 403 for a non-admin, each action audited, rename refused for a taken name.

Gates as Phase 2.

Commits: `chronicle: koinon lines`, `me: koinon pending count`, `admin: list, rename and dissolve koina`.

## Phase 4: client

`apps/web/src/api.ts`: client types for both payloads and the admin list, `api.koinon()`, `api.koinonArmies()`, one function per POST route, `api.adminKoina()`, `api.adminKoinonRename(id, name, reason)`, `api.adminKoinonDissolve(id, reason)`; `koinonPending: number` on the state type.

**State and nav.** `koinonPending` on `PlayerDashboardState` (`shared.tsx:62`, mapped at 127 with `?? 0`) and on the placeholder state. `Dashboard.tsx`: the Politics item draws `player.koinonPending` the way Family draws its count (desktop and the More sheet), and `hiddenBadgeCount` adds it so the More button shows its dot.

**Tab.** `PoliticsPanel.tsx`: the tab type gains `"koinon"`; the Koinon button is the third, with the count after the label when above zero; the body chain renders `<KoinonView player={player} onRefresh={onRefresh} />`. Update `politics-chamber.test.tsx:113` from 4 to 5 tabs.

**`apps/web/src/dashboard/panels/KoinonView.tsx`**, in the pottery look of the council tab: `DashboardCard` cards with `.meander` bands, theme tokens only, flat buttons, square corners, danger buttons outlined (Leave, Expel, Dissolve), terracotta never as text colour, the site's Cinzel and Spectral. All hooks above any early return. It loads `api.koinon()` on mount and after every action, then calls `onRefresh()`; it loads `api.koinonArmies()` only for the leader. Not in a koinon, top to bottom:

- Copy: `A koinon is a sworn company of citizens. Its leader sees the soldiers of every member.`
- **Your invitations** (only when there are any): one row per invite, `{koinonName} · invited by {inviterName} · {hours}h left`, the note `Accepting lets its leader see your soldiers.`, Accept and Decline. Under cooldown, Accept is disabled with `You left a koinon too recently. You may join another in {duration}.`
- **Found a koinon**: a name input and `Found · {foundCost} drachmae`, with the requirement line `Needs prestige {foundPrestige} and {foundCost} drachmae.` The button is disabled with the reason when prestige or purse is short or under cooldown.
- **Koina of the city**: one row per koinon, `{name} · led by {leaderName} · {members} of {cap}`; `No koina yet.` when empty.

In a koinon, top to bottom:

- **Header card**: the name, `Founded {foundedLabel}`, `{members} of {cap}`, leader and vice.
- **Take the lead** card, only when `canTakeLead`: `{leaderName} has not been seen for five days. You may take the lead.` and a `Take the lead` button.
- **Board**: for the leader and the vice, a textarea with a live `{n} / {postMaxChars}` counter and `Post`; then the posts newest first, `{authorName} · {label}` over the body, with Delete where `canDelete`; `No word from the leaders yet.` when empty. When the payload's `unread` is above zero, call `api.koinonRead()` once, then `onRefresh()`.
- **Members**: one row per member with portrait (`LobbyPortrait`, size 32), `{name} of House {houseName}`, `HouseCrest`, class, party, `Leader` / `Vice` tags, `Joined {joinedLabel}`. Leader controls on each other member's row: `Make vice` (or `Clear vice` on the vice), `Hand over the lead`, `Expel`, each behind a `window.confirm`.
- **Invite** (leader and vice): a name input and `Invite`; then the pending invites, `{playerName} · {hours}h left` with `Withdraw`.
- **Soldiers of the koinon** (leader only): one `<details>` per member, the summary `{name} · {men} men · levy {levy}`, inside it the At home rows by place, the Away rows with `{missionKind} {targetName} · back in {duration}`, the In training rows with `ready in {duration}`, and the fleet line `{pentekonters} pentekonters · {triremes} triremes` when either is above zero; `No soldiers.` for a member with none. Unit icons drawn as the Barracks roster draws them. Durations from the payload's `now`, static (no ticking).
- **Leave**: an outlined danger button behind `window.confirm`: `Leave {name}? You cannot join or found another koinon for {cooldownHours} hours.` with ` The lead passes to {successorName}.` appended for the leader (`No one is left to take it: the koinon ends.` when he is the last member).

Server errors show as they come, in the note line, as the other panels do.

**Admin.** `AdminPage.tsx`: a **Koina** section with a `Load koina` button and one row per koinon (name, leader, members, founded) with Rename (prompt for the new name, then for the reason) and Dissolve (prompt for the reason, then confirm), through the page's `act()` pattern.

**CSS** in `dashboard.css`, `koinon-*` classes only.

### Render tests

Cheap, plain DOM selectors, waiting on real state:

- `apps/web/test/koinon-view.test.tsx`, `KoinonView` against a mocked API: non-member with an invite shows Accept, Decline and the soldiers note; Found disabled with the prestige reason at prestige 19; member view as a plain member shows no post form, no leader controls, no soldiers section; as the vice shows the post form and Invite but no soldiers; as the leader shows the soldiers section from a mocked armies payload with an away row and a training row; `canTakeLead` shows the button; unread above zero calls `koinonRead` once; no hook-order warning across renders.
- `politics-chamber.test.tsx`: five tabs, still no emoji.
- A nav case (in `dashboard-refetch.test.tsx` or a new small file): `koinonPending: 2` shows `2` on the Politics nav and the More dot.
- `apps/web/test/admin-koina.test.tsx` on the `admin-verify.test.tsx` model: the list renders and Dissolve calls the API with the reason.

Gates: `pnpm -r lint`, web tsc, web build, web tests, then the full `pnpm gate` at HEAD.

Commits: `web: the Koinon tab`, `web: koinon count on the Politics nav`, `web: koina in the admin page`.

**STOP 2.** Final report with captures of the Koinon tab at desktop width and at 390px: a non-member with an invite, a plain member, the leader with the soldiers section open, and the Politics tab row at 390px showing all five tabs fitting or wrapping cleanly. Wait. Do not push.

## Scope fence

Touch only: `docs/koinon/koinon-prompt-1.md`; `content/koinon/koinon.json`; `packages/shared/src/koinon.ts`, `packages/shared/src/chronicle.ts` (the `koinon` kind only) and the package index; `packages/db/migrations/0062_koina.sql`, `packages/db/src/schema.ts`, `packages/db/src/chronicle.ts` (the reader branch only); `apps/server/src/services/koinon.ts`, `routes/koinon.ts`, `routes/me.ts` (the count only), `routes/admin.ts` (the three koina routes only), `apps/server/src/index.ts` (the loader and one register line); their tests; `apps/web/src/api.ts`, `dashboard/shared.tsx` (the state field and mapping), `dashboard/Dashboard.tsx` (the Politics count and the placeholder field), `dashboard/panels/PoliticsPanel.tsx` (the tab only), `dashboard/panels/KoinonView.tsx`, `dashboard/panels/FamilyPanel.tsx` (the renderer only), `AdminPage.tsx` (the Koina section only), `dashboard/dashboard.css` (`koinon-*` classes), `apps/web/test/`.

Nothing else. No change to the Barracks, `barracksView`, settling, the map, holdings, the market, parties, the Oligarchy, buildings, or `apps/web/public/**`. No treasury, no buildings, no musters, no map notes, no emblem, no direct messages. No settle of any player from a koinon route. Player-facing copy beyond what is quoted here is new copy: list every string in the report.

## Final report template

As the market prompt's, plus:

```
KOINON
baseline: <SHA> (admin-units-prompt-1 on main: yes/no)
migration 0062 applied: throwaway / massalia_test, idempotent rerun clean
accept race: 10 runs, 1 success 1 rejection every run
armies read-only check: rows before/after identical
sample chronicle lines: founded / joined / left / expelled / leader
captures: desktop and 390px, the four views named at STOP 2
NEW PLAYER-FACING COPY: every string not quoted in this prompt, server errors included
RECON: admin-units status, the house-name helper, the unit icon path helper
RULINGS FOR ARGIRIS: every departure from this prompt, with the reason
Committed: <SHA> <subject>, one line per commit, in order
GATE: the gate's last line at HEAD
```

## STOP 1 ruling (4 Oct 2026)

STOP 1 ruling (4 Oct 2026)

Append this ruling verbatim at the end of docs/koinon/koinon-prompt-1.md under "## STOP 1 ruling (4 Oct 2026)", as its own commit `docs: koinon prompt 1 STOP 1 ruling`, then go on to Phase 3.

1. Accepted. The art prompt 3 ruling stays in bcd6178. The economy prompt 1 ruling stays parked.
2. Accepted. The player lock comes first in acceptInvite. Put the order rule in a comment above lockKoinon: a player lock may be taken before a koinon lock, never after one. Confirm in the final report that no path breaks it.
3. Accepted. Deleted accounts are swept across the world on the two reads. One query finds the affected koinon ids, and only those koina are locked.
4. Accepted. The successor of a removed leader gets the `leader` line.
5. Accepted. Line breaks and tabs in a post become spaces.
6. Accepted. markRead takes no koinon lock.
7. Accepted. The result shape is { ok: false, code, error }.
8. Accepted, both additions. In the client, every Away line uses the wording the Barracks roster already uses for that mission kind, `return` included ("Returning to …", "Marching to …" and the rest), followed by " · back in {duration}". Do not write new mission wording. List the strings you reused in the report.
9. Accepted. routes/koinon.test.ts joins the scope fence.
10. Accepted. A dissolved koinon keeps leader_player_id, and its vice is cleared.
11. Accepted, both.

Copy: all the server copy is accepted as written, with one fix. "A inviteId is required." becomes "An inviteId is required." The playerId and postId lines stay as they are.

Phase 3 and Phase 4 go ahead as written. Run the full `pnpm gate` at HEAD before STOP 2. Captures as named at STOP 2. Do not push.
