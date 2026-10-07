# Invites 1: an invite link, and 200 drachmae when the invited player takes a seat

Save this prompt as docs/invites/invite-prompt-1.md in the first commit. Read AGENTS.md first.
Repo HEAD when this was drafted: 756248b. One migration. One concern per commit, staged by path. Recon first and STOP only if something below does not match the code; otherwise build straight through to STOP 1. Commits stay local; no push until I say push.

## What it is

Every account gets its own invite link, `https://playmassalia.com/?invite=CODE`. A new account that signs up through it records who invited it, in the world that is active at sign-up. When that player first takes a seat among the Three Hundred in that same world, the inviter's character in that world receives 200 drachmae, once. The inviter sees the link and the people they invited in a new box at the top of the Lobby's right column, and /admin shows who invited each account.

Rulings (7 Oct 2026):
- 200 drachmae for each invited player who takes a seat. Paid only in the world the player signed up in; nothing carries into a later world.
- Ten counted per inviter per world. The eleventh sign-up through a link goes through as normal and is not counted.
- No IP check: an inviter is paid for a player on the same IP.
- Never paid to a banned or deleted inviter, or to one with no living character in that world when the seat is bought.
- No Chronicle line for the payout. It is an effect_log row the /admin log shows, as market trades are.
- The reward and the cap are content, next to the seat price.

Naming: in code the feature is a referral (`users.referral_code`, the `referrals` table, `services/referrals.ts`, effect_log kind `referral_reward`), so nothing reads like the koinon's invitations (`koinon_invites`, `koinonInvites`, `inviteId`). Players see the word invite, and the link's parameter is `?invite=`.

## Scope

Nine commits; the first also saves this file. Touch only:
- docs/invites/invite-prompt-1.md (this file)
- content/politics/politics-config.json
- packages/shared/src/oligarchy.ts (`politicsConfigSchema` only)
- packages/shared/src/oligarchy.test.ts (the config assertions only)
- packages/db/migrations/0066_referrals.sql (new)
- packages/db/src/schema.ts (`users`, and the new `referrals` table)
- apps/server/src/services/referrals.ts (new)
- apps/server/src/routes/auth.ts (`AuthPayload` and the register handler only)
- apps/server/src/services/oligarchy.ts (`buySeat` and the imports only)
- apps/server/src/routes/lobby.ts (`LobbyResponse` and `activeWorldSection` only)
- apps/server/src/routes/admin.ts (the users list only)
- apps/server/src/routes/referrals.test.ts (new)
- apps/server/src/routes/lobby.test.ts (`loadPoliticsConfig()` in `beforeAll` only)
- apps/server/src/routes/admin.test.ts (one new case)
- apps/web/src/referral.ts (new)
- apps/web/src/App.tsx (one effect in `App()`)
- apps/web/src/api.ts (`register`, `LobbyResponse`, `AdminUser`)
- apps/web/src/lobby/LobbyPage.tsx (`RightColumn`, its call at :183, the new `ReferralsBox`)
- apps/web/src/lobby/lobby.css
- apps/web/src/AdminPage.tsx (the email cell only)
- apps/web/test/referral-capture.test.ts, apps/web/test/lobby-referrals.test.tsx, apps/web/test/admin-referrals.test.tsx (new)

Do not touch: the koinon and its invitations (`koinon_invites`, the koinon service and routes), the Chronicle (packages/shared/src/chronicle.ts, packages/db/src/chronicle.ts, FamilyPanel.tsx), CharacterCreation.tsx and the auth modal (both reach the code through `api.register`), the landing page's markup and CTAs, LobbyFrame.tsx and lobby/links.ts (the Discord link is a later prompt), `giveDrachmae`, `creditSeatPurchaseCut`, the `/buy-seat` route, `publicUser`, AGENTS.md. No production write.

## Phase 0: recon (read only)

Confirm each of these. On any mismatch, STOP 0 and report.
- main is at 756248b or a fast-forward of it; say which. The latest migration is 0065_altar.sql.
- `users` (packages/db/src/schema.ts:17) has no referral column. `koinonInvites` (schema.ts:1022) is the koinon's own table. No identifier in the repo contains `referral` (legal.tsx mentions "referral sources" in prose only).
- Test fixtures insert users without the new column (apps/server/src/services/oligarchy.test.ts:43, inside `createCharacter` at :41), so the column needs a database default. Every test TRUNCATE that lists users, players, player_characters or worlds uses CASCADE.
- `POST /auth/register` is apps/server/src/routes/auth.ts:98. `AuthPayload` is at :37; the user insert at :113-116; `createSession` and `recordAuthEvent` at :118-119; the non-blocking verification block at :121-129; the response `{ user, hasCharacter: false }` at :131.
- Both sign-up paths reach `api.register` (apps/web/src/api.ts:399): the auth modal (apps/web/src/App.tsx:171) and the creation wizard (apps/web/src/CharacterCreation.tsx:454).
- `buySeat` (apps/server/src/services/oligarchy.ts:76) is the only place a player takes a seat (`holder_type = 'player'` at :99, `isCouncilor: true` at :112). Its transaction (:85) takes no `lockPlayer`, which the AGENTS.md lock rule requires. The `oligarch_seat` effect_log row is at :113; the catch at :116-122 maps every unknown error to "Your dynasty already holds a seat in the chamber."; `creditSeatPurchaseCut` runs after the transaction (:125).
- `giveDrachmae` locks two players in id order (apps/server/src/services/interactions.ts:250).
- `politicsConfigSchema` (packages/shared/src/oligarchy.ts:60) is `.passthrough()` at the top level, and packages/shared/src/oligarchy.test.ts:25 parses the real content file. `getPoliticsConfig()` (apps/server/src/services/oligarchy.ts:36) throws until `loadPoliticsConfig()` (:30) has run; neither lobby.test.ts nor admin.test.ts loads it today.
- `getActiveWorldId()` (apps/server/src/services/character.ts:52), `getActivePlayer(userId, worldId)` (:65, active players only) and `findCharacterRow(playerId, worldId)` (:82, no status filter).
- `activeWorldSection` (apps/server/src/routes/lobby.ts:70) returns `citizens` (:100) and `you` (:101); `LobbyResponse` is at :30; the route is read-only. lobby.test.ts:310 rejects any raw metric key (`drachmae`, `prestige`, …) anywhere in the JSON.
- The web redeclares `LobbyResponse` (apps/web/src/api.ts:350) and `AdminUser` (:159) by hand. `RightColumn` (apps/web/src/lobby/LobbyPage.tsx:285) is rendered at :183.
- `App()` reads `?reset`, `?page` and `?verify` at apps/web/src/App.tsx:754-767; the popstate effect starts at :771; `isBareRoot` (:782) is false while any query string is present; the root probe effect depends on `[isBareRoot]` (:804). The session hint helpers (api.ts:43-67) wrap every localStorage call in try/catch.
- The /admin users list is apps/server/src/routes/admin.ts:222 and batches `charactersOf` and `lastSeenOf`; `publicUser` (:52) is shared with other routes. AdminPage.tsx:299 is the email cell. apps/web/test/admin-verify.test.tsx mocks `adminUsers`.
- `CHRONICLE_EFFECT_LOG_KINDS` (packages/shared/src/chronicle.ts:179) is the Chronicle's allowlist.
- Web DOM tests start with `// @vitest-environment jsdom`; the web suite runs two files at a time.

## Commit 1: content: the invite promo's numbers

1. Save this prompt file.
2. content/politics/politics-config.json: a new top-level block after `"endorsement"`:
   ```json
   "referrals": { "reward": 200, "perWorld": 10 }
   ```
3. packages/shared/src/oligarchy.ts: `politicsConfigSchema` gains, inside its object and with a comment, `referrals: z.object({ reward: z.number().int().positive(), perWorld: z.number().int().positive() }).strict()`.
4. packages/shared/src/oligarchy.test.ts: the real file parses with `referrals` equal to `{ reward: 200, perWorld: 10 }`, and a copy with an extra key inside `referrals` is rejected.

## Commit 2: db: referral codes and the referrals table

1. packages/db/migrations/0066_referrals.sql, idempotent, in the style of 0062 and 0065:
   ```sql
   -- The invite promo (invite prompt 1). Identifiers say referral so nothing
   -- reads like the koinon's invitations (koinon_invites).
   --   users.referral_code  each account's code for its link,
   --                        playmassalia.com/?invite=CODE: ten upper-case hex
   --                        characters from the column default, which also fills
   --                        every existing row (a volatile default is evaluated
   --                        per row)
   --   referrals            one row per account that signed up through a link:
   --                        who invited it and the world active at sign-up. An
   --                        account signs up once, so the invitee is the key.
   --                        paid_at / paid_character_id are stamped when the
   --                        invited player first takes a seat in that world and
   --                        the inviter's character there is paid.
   -- Idempotent, one transaction.
   ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_code text NOT NULL
     DEFAULT upper(substr(md5(random()::text || clock_timestamp()::text), 1, 10));
   CREATE UNIQUE INDEX IF NOT EXISTS users_referral_code_idx ON users (referral_code);

   CREATE TABLE IF NOT EXISTS referrals (
     invitee_user_id uuid PRIMARY KEY REFERENCES users(id),
     inviter_user_id uuid NOT NULL REFERENCES users(id),
     world_id uuid NOT NULL REFERENCES worlds(id),
     created_at timestamptz NOT NULL DEFAULT now(),
     paid_at timestamptz,
     paid_character_id uuid REFERENCES player_characters(id),
     CHECK (invitee_user_id <> inviter_user_id)
   );
   CREATE INDEX IF NOT EXISTS referrals_inviter_world_idx ON referrals (inviter_user_id, world_id);
   ```
   No retry on a code collision: at ten hex characters the odds are negligible at this game's size.
2. packages/db/src/schema.ts: `users` gains `referralCode: text("referral_code").notNull().default(sql\`upper(substr(md5(random()::text || clock_timestamp()::text), 1, 10))\`)` with a comment; a new `referrals` table at the end of the file mirroring the migration, the index declared for reference.

## Commit 3: server: a sign-up through an invite link records the referral

1. apps/server/src/services/referrals.ts (new). It takes the content numbers as arguments and imports nothing from oligarchy.ts, so the two services never import each other.
   - `export const REFERRAL_CODE = /^[0-9A-F]{10}$/;`
   - `export async function recordReferral(inviteeUserId: string, rawCode: unknown, perWorld: number): Promise<"recorded" | "ignored" | "full">`, in order:
     a. `rawCode` must be a string that, trimmed and upper-cased, matches `REFERRAL_CODE`; otherwise "ignored".
     b. The active world (`getActiveWorldId()`); none: "ignored".
     c. The inviter: the `users` row with that `referral_code`, `deleted_at IS NULL` and `banned_at IS NULL`, and not the new account; none: "ignored".
     d. One transaction: first `SELECT pg_advisory_xact_lock(hashtext('referral:' || <inviter id>))`, so two sign-ups through one link cannot both take the tenth place; then count the inviter's referrals in the active world; at `perWorld` or more: "full"; otherwise insert `{ inviteeUserId, inviterUserId, worldId }` with ON CONFLICT DO NOTHING and return "recorded".
2. apps/server/src/routes/auth.ts: `AuthPayload` gains `referralCode?: string`. In the register handler, after `recordAuthEvent` (:119), when the body carries `referralCode`, call `recordReferral(user.id, referralCode, getPoliticsConfig().referrals.perWorld)` inside a try/catch that logs and carries on, as the verification block below it does. Read the config only when a code is present: the suites that register without one never load the politics config and must not start logging errors. The response stays `{ user, hasCharacter: false }`, so it never tells whether a code counted.
3. apps/server/src/routes/referrals.test.ts (new), guarded to a `*_test` database like the other DB suites, set up as auth-cookie-only.test.ts:30-72 is: `Fastify({ trustProxy: true })`, the cookie plugin, the production error handler, `authRoutes` at `/auth` and `lobbyRoutes` at `/api/lobby`, `nextIp()` on every request, `RESEND_API_KEY` and `EMAIL_FROM` unset for the suite. `loadPoliticsConfig()` and `loadAgeConfig()` in `beforeAll`. Before each test, the TRUNCATE of auth-cookie-only.test.ts:62 (its CASCADE reaches referrals, oligarch_seats and effect_log) and a fresh active world with `ensureChamberSeats(worldId, politics.chamber)`. Every account is made through `POST /auth/register`, so it carries a real code; characters are inserted directly as oligarchy.test.ts:41-61 does, with "test-house" seeded as there. Cases:
   - A sign-up with the inviter's code in lower case records one referral (inviter, invitee, the active world, `paid_at` null). The response's keys are exactly `user` and `hasCharacter`. Both codes match `REFERRAL_CODE` and differ.
   - A malformed code ("XYZ"), a well-formed code nobody holds, a banned inviter's code and a deleted inviter's code: each sign-up answers 200 and records nothing.
   - With the world set to ended, a sign-up with a good code answers 200 and records nothing.
   - One referral of the inviter in a second, ended world (inserted directly) does not count: ten sign-ups record ten rows in the active world, and the eleventh answers 200 and records nothing.
   - With nine referrals recorded, two sign-ups sent together (`Promise.all`) end with exactly ten.

## Commit 4: server: the inviter is paid when the invited player takes a seat

1. apps/server/src/services/referrals.ts:
   - `export type ReferralPayout = { inviteeUserId: string; worldId: string; inviterPlayerId: string; inviterCharacterId: string; reward: number }`.
   - `export async function referralPayoutFor(buyer: CharacterRow, reward: number): Promise<ReferralPayout | null>`, read only, called before the purchase transaction: the buyer's user (`players.user_id` of `buyer.playerId`); that user's referral with `world_id = buyer.worldId` and `paid_at IS NULL`; the inviter's `users` row with `deleted_at` and `banned_at` both NULL; the inviter's active player in that world (`getActivePlayer`); its character row (`findCharacterRow`) with status "alive". Any miss: null.
   - `export async function payReferralInTx(tx: DbTx, payout: ReferralPayout, buyer: CharacterRow, now: Date): Promise<boolean>`, called inside the purchase transaction after the seat is claimed, with both players already locked:
     a. Re-read the inviter's character status under the lock; not "alive": return false, nothing written.
     b. Claim first: `UPDATE referrals SET paid_at = <now>, paid_character_id = <inviterCharacterId> WHERE invitee_user_id = <inviteeUserId> AND world_id = <worldId> AND paid_at IS NULL RETURNING invitee_user_id`. No row: return false.
     c. `UPDATE player_characters SET drachmae = drachmae + <reward> WHERE id = <inviterCharacterId> AND status = 'alive'`, row count checked. A miss cannot happen under the lock; if it does, throw `new Error("referral_credit_failed")` so the purchase rolls back rather than claim without paying.
     d. An effect_log row on the inviter's character: kind "referral_reward", detail `{ inviteeCharacterId: buyer.id, amount: reward }`. Audit only: it must not join `CHRONICLE_EFFECT_LOG_KINDS`.
2. apps/server/src/services/oligarchy.ts, `buySeat` (:76):
   - After the existing guards, before the transaction: `const payout = await referralPayoutFor(row, getPoliticsConfig().referrals.reward);`.
   - The first statements inside the transaction (:85) lock the buyer, and the inviter when there is a payout, in id order as `giveDrachmae` does: `for (const playerId of [...new Set([row.playerId, ...(payout ? [payout.inviterPlayerId] : [])])].sort()) await lockPlayer(tx, playerId);`. The buyer's lock is new; the AGENTS.md lock rule wanted it anyway.
   - After the `oligarch_seat` row (:113): `if (payout) await payReferralInTx(tx, payout, row, now);`.
   - In the catch (:116), before the fallback at :120-121: `if (message === "referral_credit_failed") throw error;`, so that state answers 500 through the error handler instead of the double-buy message.
   - `BuySeatResult`, the price, the seat choice, `creditSeatPurchaseCut` and the route stay as they are.
3. Tests in referrals.test.ts, inviter and invitee with characters at 500 drachmae:
   - The invitee buys a seat: `{ ok: true, price: 200 }`, the invitee at 300, the inviter at 700, the referral's `paid_at` set and `paid_character_id` the inviter's character, and exactly one `referral_reward` row on the inviter's character with detail `{ inviteeCharacterId, amount: 200 }`.
   - A referral already paid: the seat is bought, the inviter stays at 500, no `referral_reward` row.
   - No payout when the inviter has no character in this world, when the inviter's character is dead, when the inviter is banned, when the inviter's account is deleted, or when the referral was made in another world. In each case the seat is bought, the invitee drops to 300, the inviter stays at 500 (or has no row), and the referral stays unpaid.

## Commit 5: lobby: the inviter's link and referrals

1. apps/server/src/services/referrals.ts: `export async function referralsSection(userId: string, worldId: string, numbers: { reward: number; perWorld: number })` returning `{ code: string; reward: number; perWorld: number; invited: Array<{ name: string | null; status: "signed-up" | "playing" | "seated" | "paid" }> }`: the user's `referral_code`, then the user's referrals in that world by `created_at`, each with the invitee's active player name in that world (null without one) and a status: "paid" when `paid_at` is set, else "seated" when the invitee's character in that world holds a seat (`oligarch_seats.character_id`), else "playing" when they have an active player there, else "signed-up". One query with left joins, never one query per row. Read only.
2. apps/server/src/routes/lobby.ts: `LobbyResponse`'s `worlds.active` gains `referrals` with that type, and `activeWorldSection` (:70) adds `referrals: await referralsSection(userId, world.id, getPoliticsConfig().referrals)`. No key may be named `drachmae` (lobby.test.ts:310).
3. apps/server/src/routes/lobby.test.ts: `await loadPoliticsConfig()` in `beforeAll` beside `loadAgeConfig()` (:63), since the route now reads the config. No assertion changes.
4. Test in referrals.test.ts: an inviter with a character and four referrals in the active world, inserted with explicit `created_at` so the order is fixed: one invitee with no character; one with a character; one who bought a seat before the referral row was inserted (so it is seated and unpaid); one paid through `buySeat`. `GET /api/lobby` as the inviter returns `worlds.active.referrals` equal to `{ code, reward: 200, perWorld: 10, invited: [{ name: null, status: "signed-up" }, { name: …, status: "playing" }, { name: …, status: "seated" }, { name: …, status: "paid" }] }`, and the JSON carries none of lobby.test.ts's forbidden keys (copy its `collectKeys` check).

## Commit 6: admin: who invited each account

1. apps/server/src/services/referrals.ts: `export async function referralsOf(userIds: string[]): Promise<Map<string, { referredBy: string | null; referralsMade: number }>>`: `referredBy` is the inviter's email, `referralsMade` counts the user's referrals in every world. Batched, never one query per user.
2. apps/server/src/routes/admin.ts: the users list (:222) adds `referredBy` and `referralsMade` to each row, fetched beside `charactersOf` and `lastSeenOf`. `publicUser` and the other admin routes stay as they are.
3. apps/server/src/routes/admin.test.ts, one new case: two registered users and one referrals row between them, inserted directly in the suite's world. The invitee's row in `GET /admin/users` carries `referredBy` = the inviter's email and `referralsMade` 0; the inviter's row carries `referredBy` null and `referralsMade` 1.

## Commit 7: web: the invite link is kept until sign-up

1. apps/web/src/referral.ts (new):
   - `export const REFERRAL_KEY = "massalia.referral";`
   - `export function captureReferralFromUrl(hasSession: boolean): void`: reads `invite` from `window.location.search`. Trimmed and upper-cased, a value matching `/^[0-9A-F]{10}$/` is written to localStorage, unless `hasSession` is true (a visitor who already has an account is never attributed). Either way the `invite` parameter is then removed from the address bar with `history.replaceState`, keeping the path, any other parameters and the hash.
   - `export function storedReferral(): string | null` (a stored value that fails the pattern reads as null) and `export function clearStoredReferral(): void`.
   - Every localStorage call in try/catch, as the session hint's are (api.ts:43-67).
2. apps/web/src/App.tsx: in `App()`, one effect with an empty dependency list placed before the popstate effect (:771): `captureReferralFromUrl(hasSessionHint());`. Nothing else in `App` changes; the landing renders as it does now.
3. apps/web/src/api.ts: `register` (:399) adds `referralCode: storedReferral()` to the body when one is stored, and calls `clearStoredReferral()` after a successful response only, so a refused sign-up (an email already registered, say) keeps it for the retry. The signature does not change, so App.tsx:171 and CharacterCreation.tsx:454 need no change.
4. apps/web/test/referral-capture.test.ts (new, jsdom):
   - `/?invite=abcdef1234`: "ABCDEF1234" is stored and the address bar reads `/`.
   - With `hasSession` true: nothing is stored and the parameter is still removed.
   - `/?invite=xyz`: nothing stored, parameter removed. `/?page=terms&invite=ABCDEF1234`: stored, and the address bar reads `/?page=terms`.
   - `api.register` with a code stored sends `referralCode` in the body and clears the key after a 200; after a 409 the key stays; with nothing stored the body has no `referralCode`. Stub `fetch`.

## Commit 8: web: the Invite box in the Lobby

1. apps/web/src/api.ts: `LobbyResponse`'s `worlds.active` (:350) gains the same `referrals` field.
2. apps/web/src/lobby/LobbyPage.tsx: `export function ReferralsBox({ referrals }: { referrals: … | null })`, rendered first in `RightColumn` (:285), above Guides. `RightColumn` takes a `referrals` prop, and the call at :183 passes `lobby.worlds.active?.referrals ?? null`. Null renders nothing. Contents:
   - The panel head as the Citizens box has it (`lobby-panel-head`, `lobby-eyebrow`): eyebrow "Invite a citizen", head note "4 of 10" (the list's length, then `perWorld`).
   - "When someone you invite takes a seat among the Three Hundred, your character receives 200 drachmae. Up to 10 invitations this world." (both numbers from the payload).
   - The link, `${window.location.origin}/?invite=${code}`, in a read-only text field that selects itself on focus, and a Copy button (`lobby-btn lobby-btn-small`) calling `navigator.clipboard.writeText(link)`. The button reads "Copied" for two seconds. When the clipboard is missing or refuses, the field is focused and selected and a note reads "Copy the link by hand."
   - The list in sign-up order: the name, or "A new citizen" when null, and the state: "Signed up", "In the city", "Seated", or "Seated · 200 paid".
   - "No one yet." when the list is empty. "All 10 invitations are used this world. New sign-ups through your link do not count." when it is full.
   - The wording above is mine and yours to change at STOP 1.
3. apps/web/src/lobby/lobby.css: rules for the new box only, under the theme's rules: `--lobby-gold` (the terracotta accent) is a fill and border colour and never a text colour, corners stay square, the button stays flat, and the field shrinks (`min-width: 0`) so the link row fits a 360px phone.
4. apps/web/test/lobby-referrals.test.tsx (new, jsdom), rendering `ReferralsBox` alone with plain DOM selectors (no role queries with regex names; render tests stay cheap):
   - Four referrals (null name signed up, then playing, seated, paid): the head note reads "4 of 10", the field's value ends with `/?invite=ABCDEF1234`, and the rows read "A new citizen" / "Signed up", "In the city", "Seated", "Seated · 200 paid".
   - Copy calls `navigator.clipboard.writeText` once with the link (define `navigator.clipboard` for the test), and the button then reads "Copied".
   - Ten referrals show the used-up line; none shows "No one yet."; null renders nothing.

## Commit 9: admin web: who invited each account

1. apps/web/src/api.ts: `AdminUser` (:159) gains `referredBy: string | null; referralsMade: number`.
2. apps/web/src/AdminPage.tsx: in the email cell (:299), under the address, a small line "Invited by <email>" when `referredBy` is set and "Invited <n>" when `referralsMade` is above 0. No new column.
3. apps/web/test/admin-referrals.test.tsx (new, jsdom), in the shape of admin-verify.test.tsx: a row with `referredBy: "inviter@t", referralsMade: 2` shows "Invited by inviter@t" and "Invited 2"; a row with `referredBy: null, referralsMade: 0` shows neither.

## Gate and STOP 1

Run `DATABASE_URL=…/massalia_test pnpm gate` at HEAD after commit 9, then `pnpm audit --audit-level=high`. The gate must end `GATE GREEN: HEAD <sha>, tree clean` and the audit must exit 0. A red from a timeout in a suite this diff does not touch is a STOP with the log; never rerun to get a pass.

STOP 1. Report:
- Committed: <SHA> <subject>, one line per commit
- Gate: the last line, suite counts; the audit exit code
- The migration's SQL, verbatim
- Each new test by name
- The Invite box and the admin line as rendered, word for word, for ruling
- Any deviation, as a question for a ruling

## Push (only after I reply "push")

Not in the hour before the 00:00 UTC season rollover. Fast-forward only, plain `git push`. Report:
- remote HEAD
- the CI run with its Gate and Audit steps, and the Pages run
- Railway server and worker on the new SHA, with the deploy log's line applying 0066_referrals.sql
- API health
- in production, read only: 0066 in `__massalia_migrations`; `SELECT count(*), count(DISTINCT referral_code) FROM users` with the two numbers equal; `SELECT count(*) FROM referrals` at 0

A red run is a STOP with the log. Do not revert on your own.
