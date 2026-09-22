# The House of Roses, prompt 1: a class-triggered story for the Hetaira

## What this builds

A second interactive story beside The Silver of Artemis: The House of Roses, a one-sitting mystery offered to every Hetaira. Someone in her house is stealing; she has one night to find the thief, recover a blue vial of poison and two remedies, and perhaps learn which rival house is buying poison. Nine steps, two or three choices each, four endings.

The Story Engine lacks five things the script needs, and this prompt adds them: choices that need a minimum composure, prestige or purse (shown locked, or routed to a fallback branch when unmet); an effect that credits a good to the player's stock (`gain_good`); a class trigger with an opening date; the `{house}` token; and Chronicle lines written when a story ends. The engine stays flag-free: the three things the story remembers (whether Bion was accused, whether Kerdon was pressed, the night's outcome) are encoded as duplicated nodes in the content, and `validateStoryGraph` proves every path ends. No migration.

Rulings (Argiris, 22 Sept 2026):

- The story is offered to every character of class `hetaira` once the world reaches Winter 298 BC (World 2: 2026-09-23 00:00 UTC, 03:00 Corfu). A Hetaira created after that is offered it at once. The offer is read lazily on dashboard load, so a deploy after the rollover still offers it to everyone. The opening date is a game date, like the dated cards, so a future world opens it on its own day 9 unless the date is dropped from the registry.
- A choice with a requirement and no fallback is shown locked, with the requirement on it ("Needs Prestige 10"), and the server refuses it. A choice with a fallback (`otherwise`) is never shown locked and shows no requirement: an unmet requirement sends the player down the fallback branch.
- Thresholds: composure 50 (steps 2A, 5A, 6A and 6C when Bion was accused), prestige 10 (step 4A). A day-1 Hetaira has composure 70 and prestige 2 to 4: she passes the composure gates, fails the prestige gate and pays Lyris's 5 drachmae, so the full solve is reachable on day 1.
- Paid choices (Lyris 5 drachmae, Kerdon 10) need the purse to cover them and show their price as a chip.
- Rewards: the vial is 1 `poison`, the remedies are 2 `remedy` (the existing goods), credited at step 8 on every path, including the path that finds them at step 3. The vial comes home on every path except the watch. Silver: 20 drachmae on the name path, 50 on the purse path, 10 more from Myrto's share. Composure +5 on 8A and 9A, -5 on 9B (Bion accused) and on the watch ending; prestige -3 on the watch ending.
- Intel: the full solve writes the Chronicle line "The steward of House X is buying poison." with the house filled in. Selling or whispering it is Discord roleplay for now. Every ending writes its own Chronicle line from the script.
- `{house}` is a noble house other than the player's own, picked deterministically from the character id and the story id, so it never changes for that player.
- The offer card in the Court panel shows the story's first image (the start node's image). The same rule gives The Silver of Artemis's offer card its temple image.
- The images come from `/Users/macbook/Desktop/HouseOfRoses-v2`.

## Dates

`packages/shared/src/events.ts:214` `datedSeasonIndex({ yearBC, season })` = `(START_YEAR_BC - yearBC) * 4 + (season - 1)`, season 1 = Winter. Winter 298 BC is seasonIndex 8. World 2 started `2026-09-15T00:00:00Z`, so it opens 2026-09-23 00:00 UTC.

## Phase 0: recon (no code)

Confirm each reference. If any is not as described, or the images do not map one to one onto the ten targets below, STOP 0 with the mismatch before writing anything.

- `packages/shared/src/story.ts`: `StoryChoice` (22), `storyChoiceSchema` (49), `storyNodeSchema` (57), `storyTreeSchema` (75), `validateStoryGraph` (90).
- `apps/server/src/services/story.ts`: the flag-free comment (20), `StoryTrigger` and `STORY_TRIGGERS` (47-55), `sceneChoices` / `projectNode` / `projectState` (118-134), `getOrStartStory` (148), `getStoryState` (172), `StoryReward` (181), `summarizeRewards` (192), `advanceStory` (220), `availableStories` (356).
- `packages/shared/src/events.ts`: `EventEffect` (11), `effectSchema` (107), `datedSeasonIndex` (214).
- `apps/server/src/services/eventEngine.ts:194`: `gain_resource` only writes an effect_log row and touches no stock; no content uses it.
- `apps/server/src/services/buildings.ts`: `getBuildingsContent` (61), `getOrCreateResource` (206), `creditResource` (298). Confirm the import closure of `buildings.ts` does not reach `eventEngine.ts`, so `eventEngine.ts` may import from it.
- `apps/server/src/services/composure.ts:68`: `recoverComposure(characterId, now, exec)` returns current composure and takes a transaction.
- `packages/shared/src/league.ts:229`: `nobleHouses`, ten houses (kleitos, miltiades, xanthippos, iason, timon, aristeides, herakleides, nicanor, philon, leonidas), each with `slug` and `name`.
- `packages/shared/src/chronicle.ts`: `ChronicleType` (to 66), `ChronicleInput.market` (157), the effect_log kinds and `CHRONICLE_EFFECT_LOG_KINDS` (162-176), `TYPE_ORDER` (342, `market_purchase: 19` at 363), market staging (447). `packages/db/src/chronicle.ts:259`: the market branch, with everything else cast to campaigns.
- `apps/web/src/dashboard/panels/FamilyPanel.tsx`: `chronicleRenderers` (766), `renderChronicleEntry` (813). `apps/web/src/api.ts`: `stories` on the dashboard payload (210), the story views (244-259), the client `ChronicleType` (to 283).
- `apps/web/src/dashboard/StorySheet.tsx`: `rewardLabel` (22-33), the choice buttons (177-188). `apps/web/src/dashboard/panels/CourtPanel.tsx`: the story offer cards (514-527). `dashboard.css:3325` already styles a disabled `.event-choice-button`.
- `apps/server/src/routes/me.ts:99` passes `availableStories(character.id)` through as `stories`.
- Tests: `apps/server/src/services/story.test.ts` (`createCharacter` at 94 hard-codes `classId: "trader"`), `story-content.test.ts`, `eventEngine.test.ts`, `packages/shared/src/story.test.ts`, `packages/shared/src/chronicle.test.ts`, `packages/db/src/chronicle.test.ts`, `apps/web/test/chronicle-entry.test.tsx`.
- `effect_log.kind` is `text`, so a new kind needs no migration.
- List `/Users/macbook/Desktop/HouseOfRoses-v2`: every file's name, format, pixel size and bytes. Map each to one target below by the scene it shows. Name the WebP encoder you will use (`cwebp`, or Python Pillow with WebP support); install nothing into the repo. No encoder available is a STOP 0.

| Target under `apps/web/public/stories/` | Node(s) | Scene |
|---|---|---|
| `story-roses-00-opening.webp` | OPEN, and the offer card | A woman in a dim room, lamp in hand, an open cedar chest with an empty nest of straw; a strongbox and a shelf of clay bottles with one gap |
| `story-roses-01-courtyard.webp` | S1 | The courtyard at night, three women and an old man in a half-circle around a lamp, the mistress standing |
| `story-roses-02-kitchen.webp` | S2 | The kitchen fire, an old steward seated with folded hands, keys on his belt |
| `story-roses-03-myrto-room.webp` | S3-* | A small whitewashed room, a young woman in the doorway, the mistress kneeling at a low bed with a shawl-wrapped bundle and two bottles |
| `story-roses-04-stairs.webp` | S4-* | A flute girl on stone stairs, the instrument across her knees, a barred gate behind |
| `story-roses-05-alcove.webp` | S5-* | A narrow alcove by a heavy barred gate, a slave sitting up on a pallet, the mistress holding a lamp over him |
| `story-roses-06-trap.webp` | S6-* | A moonlit courtyard, a grey-cloaked figure at an open chest with a blue vial, a lamp opening on him |
| `story-roses-07-grey-cloak.webp` | S7-* | The grey-cloaked man on his knees, the mistress holding the vial up to the lamp, the doorkeeper at the gate |
| `story-roses-08-first-light.webp` | S8-* | First light in the courtyard, a young woman with hands clasped, two bottles back on a shelf through a doorway |
| `story-roses-09-gate.webp` | S9-* | An old steward at the gate at first light, a bundle or a ring of keys, the mistress in the doorway |

## Phase 1: the engine (four commits)

### Commit 1: `effects: gain_good credits a good to the acting player's stock`

1. Save this prompt verbatim as `docs/stories/house-of-roses-prompt-1.md`.
2. `packages/shared/src/events.ts`: `EventEffect` gains `{ type: "gain_good"; good: string; amount: number }`; `effectSchema` gains `z.object({ type: z.literal("gain_good"), good: z.string().min(1), amount: z.number().int().positive() })`, with a comment: credits the acting player's stock of a good. `gain_resource` stays exactly as it is.
3. `apps/server/src/services/eventEngine.ts` `applyEffectsInTx`, case `gain_good`: read the acting character's `playerId`, then `getOrCreateResource(tx, playerId, effect.good, now)` and `creditResource(tx, row.id, effect.amount)` from `./buildings.js`, and log `effect_log` kind `gain_good` with `detail: { good, amount, value }` (value = the new stock). Every caller already holds the player lock.
4. `apps/server/src/services/eventEngine.test.ts`: a `gain_good` of 2 `remedy` inside a caller-owned transaction creates the resources row at 2; a second one makes it 4; one effect_log row per effect with the new value.

### Commit 2: `stories: requirements, fallback branches, chronicle lines and the house token (shared)`

`packages/shared/src/story.ts`:

1. `StoryRequirement = { composure?: number; prestige?: number; drachmae?: number }`, zod `.strict()` (a misspelt key fails the boot), composure and prestige integers 0 to 100, drachmae an integer of at least 1, refined to hold at least one key.
2. `StoryChoice` gains `requires?: StoryRequirement` and `otherwise?: { result?: string; next: string; rewards?: EventEffect[] }`. A terminal node gains `chronicle?: string[]` (non-empty strings): the lines written to the player's Chronicle when the story ends there.
3. `validateStoryGraph` also reports: an `otherwise.next` that resolves to no node (`Choice "<id>" in node "<node>" falls back to missing node "<next>"`); an `otherwise` on a choice without `requires`; a scene where every choice has `requires` and none has `otherwise` (`Node "<id>" can lock every choice`); any `{…}` token other than `{house}` in an eyebrow, paragraph, choice text, result, fallback result or chronicle line (`Unknown token "<token>" in node "<id>"`). Reachability follows `otherwise.next` as well as `next`.
4. Pure helpers, exported:
   - `storyHouseName(characterId, storyId, ownHouseSlug, houses = nobleHouses): string`: the houses other than `ownHouseSlug`, sorted by slug, indexed by a 32-bit FNV-1a hash of `${characterId}:${storyId}` modulo their count; returns the house's `name`.
   - `fillStoryText(text, vars: { house: string }): string`: replaces every `{house}`.
   - `requirementMet(req, ctx: { composure: number; prestige: number; drachmae: number }): boolean`: every listed minimum is at most the value.
   - `requirementLabel(req): string`: `Composure 50`, `Prestige 10`, `5 drachmae`, in that order, joined with ` · `.
   - `storyCover(tree): { title: string; image?: string }`: the title and the start node's image, the `image` key omitted when there is none.
5. `packages/shared/src/story.test.ts`: the schema keeps `requires`, `otherwise` and `chronicle`; rejects `requires: {}` and `requires: { prestiege: 10 }`; each new validator message fires on a minimal tree; a node reachable only through an `otherwise` is not reported as an orphan; for each of the ten slugs, `storyHouseName` over 50 random ids never returns that slug's own name, repeats itself for the same inputs, and 200 ids produce at least 5 distinct names; `fillStoryText`, `requirementMet`, `requirementLabel` and `storyCover` with and without a start image.

### Commit 3: `stories: class trigger, locked choices, fallbacks and cover images (server)`

`apps/server/src/services/story.ts`:

1. `StoryTrigger` becomes `{ kind: "festival"; festivalId: string } | { kind: "class"; classId: string; opensAt?: { yearBC: number; season: number } }`. The registry stays in code (update the comment at 47-51: two kinds now, still no column). No new registry entry in this commit.
2. `StoryRuleReason` gains `"locked"` with status 403 and the message `That choice is closed to you.`
3. `storyContext(characterId, now, exec = db)` returns `{ houseSlug, composure, prestige, drachmae }`: `composure` from `recoverComposure(characterId, now, exec)`, the rest from `player_characters`.
4. Projections take the context. Every projected string (eyebrow, paragraphs, choice text, result) goes through `fillStoryText` with `storyHouseName(characterId, storyId, ctx.houseSlug)`. A choice view is `{ id, text, locked?: true, requirement?: string, price?: number }`: a choice with `requires` and no `otherwise` gets `locked: true` and `requirement: requirementLabel(requires)` when `requirementMet` fails, and `price: requires.drachmae` whenever that is set, locked or not; a choice with `otherwise` carries none of the three. No view carries `next`, `rewards`, `result`, `requires`, `otherwise` or `chronicle`.
5. `advanceStory`: after the progress row lock and the choice lookup, when the choice has `requires`, build the context inside the transaction (`recoverComposure(characterId, now, tx)` and the locked character row). Unmet with no `otherwise`: throw `locked` before any write. Unmet with `otherwise`: apply `otherwise.rewards`, move to `otherwise.next`, report `otherwise.result`; the choice's own `rewards` are not applied. Met, or no `requires`: as today. The result text is filled. Keep the id of the node now current from the transaction, and after the post-transaction passes read the context again and project that node, so its locks reflect the wallet and composure after this choice. The completed-replay no-op stays a no-op.
6. `StoryReward` gains `{ kind: "good"; good: string; name: string; amount: number }`; `summarizeRewards` maps `gain_good` to it with `name` from `getBuildingsContent().goodLabels[good]`, falling back to the id.
7. `availableStories(characterId, registry = STORY_TRIGGERS, now = new Date())`: a `class` trigger with no progress row offers the story when the character's `class_id` equals `classId`, `opensAt` is absent or `gameDate(now, world.startedAt).seasonIndex >= datedSeasonIndex(opensAt)`, and the `stories` row exists. Read the class and the world start once per call, only when the registry holds a class trigger. A progress row behaves as today for both kinds. Every offered or active entry carries `image` from `storyCover` (one primary-key read of `stories.tree`), with the key omitted when the start node has no image. The festival guard query keeps its shape.
8. `apps/server/src/services/story.test.ts` (load the buildings content in `beforeAll`; `createCharacter` takes an optional `classId`, default `trader`), new cases from 27, with fixture stories as needed:
   - 27: a class trigger for `hetaira` opening `{ yearBC: 298, season: 1 }`: with the world started 7 days and 10 minutes ago, a Hetaira gets `[]`; 8 days and 10 minutes ago, `offered` with the fixture's start image; a trader gets `[]`; with no `opensAt` a Hetaira is offered at once.
   - 28: `startStory` on a class-offered story creates the row at `tree.start`; a trader gets `not_eligible` and nothing is written.
   - 29: at prestige 0 a `requires: { prestige: 10 }` choice projects `locked: true` and `requirement: "Prestige 10"`; advancing it throws `locked` (403) and leaves the progress row, the wallet and effect_log unchanged. At prestige 10 it advances.
   - 30: a `requires: { drachmae: 5 }` choice with a `change_drachmae -5` reward projects `price: 5` and locks at 4 drachmae; at 5 drachmae it advances and the wallet reads 0.
   - 31: a choice with `requires: { composure: 50 }` and an `otherwise`: with composure set to 40 (and `last_composure_update` set to now) it goes to the fallback node with the fallback result and rewards, and not the choice's own rewards; at 60 it takes the main branch. The choice projects no `locked`, `requirement` or `price`.
   - 32: `{house}` in a paragraph and a result is filled with a noble house name, the same on two calls, and no `{` survives in any projected string.
   - 33: a `gain_good` of 2 `remedy` on a choice credits the player's stock and summarizes as `{ kind: "good", good: "remedy", name: "Remedy", amount: 2 }`.
   - Extend case 26: no `requires`, `otherwise` or `chronicle` key in the state projection or the advance node.

### Commit 4: `chronicle: story_line entries`

1. `packages/shared/src/chronicle.ts`: `ChronicleType` gains `"story_line"`; `ChronicleEffectLogKind` and `CHRONICLE_EFFECT_LOG_KINDS` gain it; `isChronicleStoryKind`; `ChronicleStoryRow = { id: string; at: number; payload: { storyId: string; line: string } }`; `ChronicleInput.stories?: ChronicleStoryRow[]`, staged after the market rows; `TYPE_ORDER.story_line = 20`. Comment: the one kind whose payload is prose, the authored line with its token already filled, since the web has no story content.
2. `packages/db/src/chronicle.ts`: a `story_line` branch ahead of the market branch, collected into `stories` and passed to `buildChronicle`.
3. `apps/server/src/services/story.ts`: when an advance completes on a terminal with `chronicle`, in the same transaction after the terminal rewards, insert one `effect_log` row per line: kind `story_line`, `detail: { chronicle: { storyId, line } }` with the line filled, `createdAt` the transaction's instant plus the line's index in milliseconds, so the lines keep their order.
4. `apps/web/src/api.ts`: the client `ChronicleType` gains `"story_line"`. `FamilyPanel.tsx` `chronicleRenderers`: `story_line: (p) => String(p.line ?? "")`.
5. Tests: `packages/shared/src/chronicle.test.ts`, two story rows in one season keep their order and sort after the market kinds; `packages/db/src/chronicle.test.ts`, a `story_line` row reaches the chronicle and one without `detail.chronicle` is skipped; `story.test.ts`, a terminal with two chronicle lines writes two `story_line` rows in order with `{house}` filled, and a terminal without `chronicle` writes none; `apps/web/test/chronicle-entry.test.tsx`, a `story_line` entry renders its line and one with no line renders `""`.

## Phase 2: the story (one commit)

### Commit 5: `content: The House of Roses, a Hetaira story, with its ten images`

1. `content/stories/house-of-roses.json`: extract the JSON block under "The story file" at the end of `docs/stories/house-of-roses-prompt-1.md` with a script (the text between the ```` ```json ```` fence and its closing fence), write it byte for byte, and confirm it parses. Never retype it.
2. The ten images at the target names above: WebP, 1134 px wide, height by the source's aspect ratio (no crop), quality about 82, each under 200 KB. A source already WebP at 1134 px wide is copied as is.
3. `STORY_TRIGGERS` gains `"house-of-roses": { kind: "class", classId: "hetaira", opensAt: { yearBC: 298, season: 1 } }`.
4. `apps/server/src/services/story-content.test.ts`, a House of Roses block (pure): the file parses and `validateStoryGraph` returns `[]`; start `OPEN`, 35 nodes (31 scenes, 4 terminals); every `gain_good` names a good in `content/buildings/buildings.json` `goodLabels`; a walk of every path from `OPEN` (following `next` and `otherwise.next`, summing rewards) finds 12,636 paths, each crediting exactly 2 `remedy`, 1 `poison` except the paths ending at `END-watch` (0), and reaching `END-full` exactly when it took the choice `name`. The existing image test (5) covers the ten files. In the DB-gated seed block: `loadStories` also upserts `house-of-roses` at version 1 with 35 nodes, and `STORY_TRIGGERS["house-of-roses"]` equals the entry above.

## Phase 3: the client (one commit)

### Commit 6: `web: locked and priced story choices, goods in the reward strip, cover art on the offer card`

1. `apps/web/src/api.ts`: the `stories` entry gains `image?: string`; `StoryChoiceView` gains `locked?: boolean; requirement?: string; price?: number`; `StoryReward` gains `{ kind: "good"; good: string; name: string; amount: number }`.
2. `StorySheet.tsx`: a choice button is `disabled={busy || choice.locked === true}`. Under its text, in `<span className="choice-costs">`: a locked choice shows `<span className="cost-chip cost-negative">Needs {requirement}</span>`; an unlocked choice with a price shows `<span className="cost-chip cost-negative">−{price} drachmae</span>`. `rewardLabel` renders a good as `${signed(amount)} ${name}`. No new CSS.
3. `CourtPanel.tsx`: move the offer card into an exported `StoryOfferCard({ story, onOpen })` in the same file, unchanged except for a `PanelBanner scene="" art={webAssetUrl(story.image)}` between the kicker and the title when `story.image` is set.
4. Render tests, plain DOM selectors, no fixed delays:
   - `apps/web/test/story-sheet.test.tsx` (mock `api.storyStart` and `api.storyAdvance`): a locked choice is disabled and shows `Needs Prestige 10`; a priced choice is enabled and shows `−5 drachmae`; clicking a plain choice calls `storyAdvance` with its id; an advance whose `rewardsGranted` holds 2 Remedy shows `+2 Remedy` in the interstitial.
   - `apps/web/test/story-offer-card.test.tsx`: with an image, a `.panel-banner` whose background image carries `webAssetUrl` of it; without one, no `.panel-banner`; the button reads Begin for `offered` and Continue for `active`.

## Gate and STOP 1

`DATABASE_URL=…/massalia_test pnpm gate` at HEAD after the last commit, ending `GATE GREEN … tree clean`. No push. Report:

```
Committed: <SHA> effects: gain_good credits a good to the acting player's stock
Committed: <SHA> stories: requirements, fallback branches, chronicle lines and the house token (shared)
Committed: <SHA> stories: class trigger, locked choices, fallbacks and cover images (server)
Committed: <SHA> chronicle: story_line entries
Committed: <SHA> content: The House of Roses, a Hetaira story, with its ten images
Committed: <SHA> web: locked and priced story choices, goods in the reward strip, cover art on the offer card
Gate: <the gate's last line>
Images: <target <- source, encoder, pixel size, bytes, for all ten>
Deviations: <each as a ruling for Argiris, or "none">
Post-deploy checks:
  select id, version, jsonb_array_length(tree->'nodes') from stories where id = 'house-of-roses';   -- 1 row, version 1, 35
  after 2026-09-23 00:00 UTC, on a Hetaira: the Court shows the offer card with the opening image; a non-Hetaira sees no card
  select status, count(*) from story_progress where story_id = 'house-of-roses' group by status;
```

## Scope fence

Do not touch: `content/stories/artemisia-silver.json` and its registry entry; `gain_resource`; the festival system, event cards, daily decisions and `applyExpiredDefaults`; the composure rules; the market; the barracks; the worker; any other content file; any stylesheet; any guide, news or copy beyond the strings in this prompt. No migration. No balance numbers beyond those in the story file. No refactors along the way.

## The story file

```json
{
  "id": "house-of-roses",
  "version": 1,
  "tree": {
    "title": "The House of Roses",
    "start": "OPEN",
    "nodes": [
      {
        "type": "scene",
        "id": "OPEN",
        "body": {
          "paragraphs": [
            "The count is short again. Forty drachmae gone from the strongbox in a month, from a box with two keys and not a scratch on it. Tonight, for the first time since the Dionysia, you opened the cedar chest, and the blue vial was not in its straw. On the physician's shelf, two of the five stoppered remedies are missing.",
            "Silver you can lose. Remedies you can buy again. But a vial of that particular blue, found anywhere in this city with your house's seal on the wax, is a rope.",
            "Someone in the House of Roses is stealing. The next symposium is tomorrow. You have tonight."
          ]
        },
        "image": "/stories/story-roses-00-opening.webp",
        "choices": [
          {
            "id": "lamp",
            "text": "Take up the lamp.",
            "next": "S1"
          }
        ]
      },
      {
        "type": "scene",
        "id": "S1",
        "body": {
          "eyebrow": "Where to begin",
          "paragraphs": [
            "The house is asleep. Where do you begin?"
          ]
        },
        "image": "/stories/story-roses-01-courtyard.webp",
        "choices": [
          {
            "id": "strongbox",
            "text": "The strongbox.",
            "result": "Two keys open it. Yours is on the cord at your neck. The other hangs from Bion's belt, and Bion has grown fond of the wine he pours for guests. The lock is clean. Whoever opened it had a key.",
            "next": "S2"
          },
          {
            "id": "chest",
            "text": "The cedar chest.",
            "result": "You bring the lamp close. The clasp is whole, but there are three fine scratches beside the keyhole, the kind a picklock leaves and a key never does. This was not a girl with borrowed keys. This was a hand that has done it before.",
            "next": "S2"
          },
          {
            "id": "women",
            "text": "The women, all together.",
            "result": "You call them to the courtyard and say nothing about the vial, only the silver. They close ranks the way women do who share a roof. You learn what silence teaches: Lyris keeps glancing at the back gate. Myrto looks at her feet.",
            "next": "S2"
          }
        ]
      },
      {
        "type": "scene",
        "id": "S2",
        "body": {
          "eyebrow": "Bion",
          "paragraphs": [
            "Bion has kept this house since before you owned it. He is honest in the way old men are honest, which is to say he is ashamed of the things he does badly. He is waiting for you by the kitchen fire with his hands folded."
          ]
        },
        "image": "/stories/story-roses-02-kitchen.webp",
        "choices": [
          {
            "id": "press",
            "text": "Press him.",
            "requires": {
              "composure": 50
            },
            "result": "\"Bion. The nights of the last two symposia. Where were your keys?\" He looks at the fire for a long time. \"On my belt, mistress. And I was asleep on the bench by the door, because the Milesian would not stop filling my cup. When I woke the keys were on the wrong hip.\" He has said it before you asked. That is the whole of his confession, and it is enough.",
            "next": "S3-b"
          },
          {
            "id": "pour",
            "text": "Pour him a cup.",
            "result": "You pour, and sit, and let him talk of the old days until the wine does your work. \"I fell asleep at the door, mistress. Twice. The keys were on my belt and I cannot swear they stayed there.\" He does not look at you. He knows what it means.",
            "next": "S3-b"
          },
          {
            "id": "accuse",
            "text": "Accuse him.",
            "result": "\"It was you.\" He stands up slowly. He does not argue, and that is worse. \"Then I will fetch my things in the morning.\" He goes to his room and bars it, and for the rest of the night the door does not open. Whatever else happens, you have lost his help.",
            "next": "S3-x"
          }
        ]
      },
      {
        "type": "scene",
        "id": "S3-b",
        "body": {
          "eyebrow": "Myrto",
          "paragraphs": [
            "Myrto came from Emporion in the spring, the youngest woman of the house and the quickest to learn. She has a new bracelet of twisted silver that she keeps turning on her wrist."
          ]
        },
        "image": "/stories/story-roses-03-myrto-room.webp",
        "choices": [
          {
            "id": "bracelet",
            "text": "Admire the bracelet.",
            "result": "\"That is fine work. Who has good taste?\" She colours and laughs. \"The shipowner's son. The one who cannot sing.\" The tension goes out of her, and she talks. \"Mistress, if you are asking about the silver, ask Lyris why she is awake at the third watch. I am not.\"",
            "next": "S4-b"
          },
          {
            "id": "straight",
            "text": "Ask her straight.",
            "result": "\"Did you take from this house?\" Her eyes fill and she shakes her head, and keeps shaking it. You learn nothing, and she will not speak to you again tonight.",
            "next": "S4-b"
          },
          {
            "id": "search",
            "text": "Search her room.",
            "result": "Under the mattress, a letter from Emporion in a bad hand: her mother is sick and the physician there wants more than a flute girl's wages. Under the bed, wrapped in a shawl, two clay bottles with your physician's mark. She is in the doorway before you turn. \"I was going to send them with the next ship. Only those two. I never touched the box, mistress, I swear it on my mother.\" You believe her about the box. The scratches on the chest were not made by a girl who hides bottles under her bed.",
            "next": "S4-b"
          }
        ]
      },
      {
        "type": "scene",
        "id": "S3-x",
        "body": {
          "eyebrow": "Myrto",
          "paragraphs": [
            "Myrto came from Emporion in the spring, the youngest woman of the house and the quickest to learn. She has a new bracelet of twisted silver that she keeps turning on her wrist."
          ]
        },
        "image": "/stories/story-roses-03-myrto-room.webp",
        "choices": [
          {
            "id": "bracelet",
            "text": "Admire the bracelet.",
            "result": "\"That is fine work. Who has good taste?\" She colours and laughs. \"The shipowner's son. The one who cannot sing.\" The tension goes out of her, and she talks. \"Mistress, if you are asking about the silver, ask Lyris why she is awake at the third watch. I am not.\"",
            "next": "S4-x"
          },
          {
            "id": "straight",
            "text": "Ask her straight.",
            "result": "\"Did you take from this house?\" Her eyes fill and she shakes her head, and keeps shaking it. You learn nothing, and she will not speak to you again tonight.",
            "next": "S4-x"
          },
          {
            "id": "search",
            "text": "Search her room.",
            "result": "Under the mattress, a letter from Emporion in a bad hand: her mother is sick and the physician there wants more than a flute girl's wages. Under the bed, wrapped in a shawl, two clay bottles with your physician's mark. She is in the doorway before you turn. \"I was going to send them with the next ship. Only those two. I never touched the box, mistress, I swear it on my mother.\" You believe her about the box. The scratches on the chest were not made by a girl who hides bottles under her bed.",
            "next": "S4-x"
          }
        ]
      },
      {
        "type": "scene",
        "id": "S4-b",
        "body": {
          "eyebrow": "Lyris",
          "paragraphs": [
            "Lyris plays the flute at your symposia and hears everything a man says when he thinks a flute girl is furniture. She is sitting on the stairs with the instrument across her knees."
          ]
        },
        "image": "/stories/story-roses-04-stairs.webp",
        "choices": [
          {
            "id": "standing",
            "text": "Ask her as a woman of standing asks.",
            "requires": {
              "prestige": 10
            },
            "result": "She looks at you the way she looks at the men, deciding. Then: \"Sandals, mistress. A man's. At the back gate, after the last two symposia, when the steward was asleep on his bench. He did not climb. The bar was up for him.\" She has said it and now she is afraid. \"Kerdon lifts the bar.\"",
            "next": "S5-b"
          },
          {
            "id": "coin",
            "text": "A coin in her hand.",
            "requires": {
              "drachmae": 5
            },
            "result": "She closes her fingers over it. \"A man came through the back gate. Twice. Both times on the nights old Bion drank. Nobody climbs that wall. Somebody lifts the bar.\" She does not say the name. She does not have to. Only Kerdon sleeps by the bar.",
            "next": "S5-b",
            "rewards": [
              {
                "type": "change_drachmae",
                "amount": -5
              }
            ]
          },
          {
            "id": "kindly",
            "text": "Ask kindly, with nothing.",
            "result": "She lifts the flute and plays a few bars of something Ionian and looks at the wall. You are her mistress, not her friend. When you stand to go she says, very quietly, \"I don't like the doorkeeper.\" It is all you will get.",
            "next": "S5-b"
          }
        ]
      },
      {
        "type": "scene",
        "id": "S4-x",
        "body": {
          "eyebrow": "Lyris",
          "paragraphs": [
            "Lyris plays the flute at your symposia and hears everything a man says when he thinks a flute girl is furniture. She is sitting on the stairs with the instrument across her knees."
          ]
        },
        "image": "/stories/story-roses-04-stairs.webp",
        "choices": [
          {
            "id": "standing",
            "text": "Ask her as a woman of standing asks.",
            "requires": {
              "prestige": 10
            },
            "result": "She looks at you the way she looks at the men, deciding. Then: \"Sandals, mistress. A man's. At the back gate, after the last two symposia, when the steward was asleep on his bench. He did not climb. The bar was up for him.\" She has said it and now she is afraid. \"Kerdon lifts the bar.\"",
            "next": "S5-x"
          },
          {
            "id": "coin",
            "text": "A coin in her hand.",
            "requires": {
              "drachmae": 5
            },
            "result": "She closes her fingers over it. \"A man came through the back gate. Twice. Both times on the nights old Bion drank. Nobody climbs that wall. Somebody lifts the bar.\" She does not say the name. She does not have to. Only Kerdon sleeps by the bar.",
            "next": "S5-x",
            "rewards": [
              {
                "type": "change_drachmae",
                "amount": -5
              }
            ]
          },
          {
            "id": "kindly",
            "text": "Ask kindly, with nothing.",
            "result": "She lifts the flute and plays a few bars of something Ionian and looks at the wall. You are her mistress, not her friend. When you stand to go she says, very quietly, \"I don't like the doorkeeper.\" It is all you will get.",
            "next": "S5-x"
          }
        ]
      },
      {
        "type": "scene",
        "id": "S5-b",
        "body": {
          "eyebrow": "Kerdon",
          "paragraphs": [
            "Kerdon sleeps in the alcove by the back gate. He is not a bad slave, only a cheap one, and cheap men are bought cheaply."
          ]
        },
        "image": "/stories/story-roses-05-alcove.webp",
        "choices": [
          {
            "id": "threaten",
            "text": "Threaten him.",
            "requires": {
              "composure": 50
            },
            "result": "You do not raise your voice. You tell him what the market pays for a doorkeeper who lifts bars at night, and which of your patrons sits on the bench that hears such cases. He talks. \"A gentleman's man, mistress. Grey cloak. He gives two obols to have the bar up on symposium nights. He said he was collecting messages. I never looked at what he carried.\"",
            "next": "S6-b-p"
          },
          {
            "id": "buy",
            "text": "Buy him.",
            "requires": {
              "drachmae": 10
            },
            "result": "The coins do what fear would have done, and quicker. \"Grey cloak, a gentleman's man. Two obols to lift the bar on symposium nights, when the steward drinks. He comes and goes in the time it takes to say a prayer.\" He adds, unasked, \"He is due tomorrow.\"",
            "next": "S6-b-p",
            "rewards": [
              {
                "type": "change_drachmae",
                "amount": -10
              }
            ]
          },
          {
            "id": "signal",
            "text": "Ask him to signal next time.",
            "result": "He swears he will. He swears on Hermes. You have heard Kerdon swear before.",
            "next": "S6-b-q"
          }
        ]
      },
      {
        "type": "scene",
        "id": "S5-x",
        "body": {
          "eyebrow": "Kerdon",
          "paragraphs": [
            "Kerdon sleeps in the alcove by the back gate. He is not a bad slave, only a cheap one, and cheap men are bought cheaply."
          ]
        },
        "image": "/stories/story-roses-05-alcove.webp",
        "choices": [
          {
            "id": "threaten",
            "text": "Threaten him.",
            "requires": {
              "composure": 50
            },
            "result": "You do not raise your voice. You tell him what the market pays for a doorkeeper who lifts bars at night, and which of your patrons sits on the bench that hears such cases. He talks. \"A gentleman's man, mistress. Grey cloak. He gives two obols to have the bar up on symposium nights. He said he was collecting messages. I never looked at what he carried.\"",
            "next": "S6-x-p"
          },
          {
            "id": "buy",
            "text": "Buy him.",
            "requires": {
              "drachmae": 10
            },
            "result": "The coins do what fear would have done, and quicker. \"Grey cloak, a gentleman's man. Two obols to lift the bar on symposium nights, when the steward drinks. He comes and goes in the time it takes to say a prayer.\" He adds, unasked, \"He is due tomorrow.\"",
            "next": "S6-x-p",
            "rewards": [
              {
                "type": "change_drachmae",
                "amount": -10
              }
            ]
          },
          {
            "id": "signal",
            "text": "Ask him to signal next time.",
            "result": "He swears he will. He swears on Hermes. You have heard Kerdon swear before.",
            "next": "S6-x-q"
          }
        ]
      },
      {
        "type": "scene",
        "id": "S6-b-p",
        "body": {
          "eyebrow": "The trap",
          "paragraphs": [
            "Tomorrow is a symposium night. You set the table as always, let the wine go round, let Bion pour, and when the last guest is gone you leave the strongbox where it stands with twenty drachmae in it, each coin nicked once at the rim with a knife."
          ]
        },
        "image": "/stories/story-roses-06-trap.webp",
        "choices": [
          {
            "id": "wait",
            "text": "Sit in the dark and wait.",
            "requires": {
              "composure": 50
            },
            "result": "The lamp is shuttered. The house creaks and settles. Past the third watch the bar lifts with barely a sound and a grey cloak crosses the courtyard, straight to the cedar chest, and you understand that he is not here for silver at all. He has the vial in his hand when your light opens on him.",
            "next": "S7-b"
          },
          {
            "id": "kerdon",
            "text": "Let Kerdon watch.",
            "result": "Kerdon is awake because he is afraid, which is the only reason Kerdon is ever awake. When the bar lifts he shouts, and the man in the grey cloak is caught with the chest open and the vial in his hand.",
            "next": "S7-b"
          },
          {
            "id": "flute",
            "text": "Have Lyris play late.",
            "result": "The flute goes on past midnight and the house sounds awake, and no one comes. The next symposium, four days on, you are ready. Bion pours water into his own cup all evening and sits by the door with his eyes open, and when the bar lifts, the man in the grey cloak walks into two lamps.",
            "next": "S7-b"
          }
        ]
      },
      {
        "type": "scene",
        "id": "S6-b-q",
        "body": {
          "eyebrow": "The trap",
          "paragraphs": [
            "Tomorrow is a symposium night. You set the table as always, let the wine go round, let Bion pour, and when the last guest is gone you leave the strongbox where it stands with twenty drachmae in it, each coin nicked once at the rim with a knife."
          ]
        },
        "image": "/stories/story-roses-06-trap.webp",
        "choices": [
          {
            "id": "wait",
            "text": "Sit in the dark and wait.",
            "requires": {
              "composure": 50
            },
            "result": "The lamp is shuttered. The house creaks and settles. Past the third watch the bar lifts with barely a sound and a grey cloak crosses the courtyard, straight to the cedar chest, and you understand that he is not here for silver at all. He has the vial in his hand when your light opens on him.",
            "next": "S7-b"
          },
          {
            "id": "kerdon",
            "text": "Let Kerdon watch.",
            "result": "Kerdon sleeps. You wake to the sound of the bar dropping back and run to the courtyard in time to see a grey cloak go over the gate. On the flagstones where he fell, the blue vial, unbroken. The marked silver is gone with him, and so is his name.",
            "next": "S8-b-escaped",
            "rewards": [
              {
                "type": "gain_good",
                "good": "poison",
                "amount": 1
              }
            ]
          },
          {
            "id": "flute",
            "text": "Have Lyris play late.",
            "result": "The flute goes on past midnight and the house sounds awake, and no one comes. The next symposium, four days on, you are ready. Bion pours water into his own cup all evening and sits by the door with his eyes open, and when the bar lifts, the man in the grey cloak walks into two lamps.",
            "next": "S7-b"
          }
        ]
      },
      {
        "type": "scene",
        "id": "S6-x-p",
        "body": {
          "eyebrow": "The trap",
          "paragraphs": [
            "Tomorrow is a symposium night. You set the table as always, let the wine go round, let Bion pour, and when the last guest is gone you leave the strongbox where it stands with twenty drachmae in it, each coin nicked once at the rim with a knife."
          ]
        },
        "image": "/stories/story-roses-06-trap.webp",
        "choices": [
          {
            "id": "wait",
            "text": "Sit in the dark and wait.",
            "requires": {
              "composure": 50
            },
            "result": "The lamp is shuttered. The house creaks and settles. Past the third watch the bar lifts with barely a sound and a grey cloak crosses the courtyard, straight to the cedar chest, and you understand that he is not here for silver at all. He has the vial in his hand when your light opens on him.",
            "next": "S7-x"
          },
          {
            "id": "kerdon",
            "text": "Let Kerdon watch.",
            "result": "Kerdon is awake because he is afraid, which is the only reason Kerdon is ever awake. When the bar lifts he shouts, and the man in the grey cloak is caught with the chest open and the vial in his hand.",
            "next": "S7-x"
          },
          {
            "id": "flute",
            "text": "Have Lyris play late.",
            "requires": {
              "composure": 50
            },
            "result": "The flute goes on past midnight and the house sounds awake, and no one comes. The next symposium, four days on, you are ready. You sit by the door yourself, because there is no one else, and when the bar lifts, the man in the grey cloak walks into your lamp.",
            "next": "S7-x",
            "otherwise": {
              "result": "The flute goes on past midnight and the house sounds awake, and no one comes. The next symposium, four days on, you sit by the door yourself, because there is no one else. Past the third watch your eyes close. You wake to the sound of the bar dropping back and run to the courtyard in time to see a grey cloak go over the gate. On the flagstones where he fell, the blue vial, unbroken. The marked silver is gone with him, and so is his name.",
              "next": "S8-x-escaped",
              "rewards": [
                {
                  "type": "gain_good",
                  "good": "poison",
                  "amount": 1
                }
              ]
            }
          }
        ]
      },
      {
        "type": "scene",
        "id": "S6-x-q",
        "body": {
          "eyebrow": "The trap",
          "paragraphs": [
            "Tomorrow is a symposium night. You set the table as always, let the wine go round, let Bion pour, and when the last guest is gone you leave the strongbox where it stands with twenty drachmae in it, each coin nicked once at the rim with a knife."
          ]
        },
        "image": "/stories/story-roses-06-trap.webp",
        "choices": [
          {
            "id": "wait",
            "text": "Sit in the dark and wait.",
            "requires": {
              "composure": 50
            },
            "result": "The lamp is shuttered. The house creaks and settles. Past the third watch the bar lifts with barely a sound and a grey cloak crosses the courtyard, straight to the cedar chest, and you understand that he is not here for silver at all. He has the vial in his hand when your light opens on him.",
            "next": "S7-x"
          },
          {
            "id": "kerdon",
            "text": "Let Kerdon watch.",
            "result": "Kerdon sleeps. You wake to the sound of the bar dropping back and run to the courtyard in time to see a grey cloak go over the gate. On the flagstones where he fell, the blue vial, unbroken. The marked silver is gone with him, and so is his name.",
            "next": "S8-x-escaped",
            "rewards": [
              {
                "type": "gain_good",
                "good": "poison",
                "amount": 1
              }
            ]
          },
          {
            "id": "flute",
            "text": "Have Lyris play late.",
            "requires": {
              "composure": 50
            },
            "result": "The flute goes on past midnight and the house sounds awake, and no one comes. The next symposium, four days on, you are ready. You sit by the door yourself, because there is no one else, and when the bar lifts, the man in the grey cloak walks into your lamp.",
            "next": "S7-x",
            "otherwise": {
              "result": "The flute goes on past midnight and the house sounds awake, and no one comes. The next symposium, four days on, you sit by the door yourself, because there is no one else. Past the third watch your eyes close. You wake to the sound of the bar dropping back and run to the courtyard in time to see a grey cloak go over the gate. On the flagstones where he fell, the blue vial, unbroken. The marked silver is gone with him, and so is his name.",
              "next": "S8-x-escaped",
              "rewards": [
                {
                  "type": "gain_good",
                  "good": "poison",
                  "amount": 1
                }
              ]
            }
          }
        ]
      },
      {
        "type": "scene",
        "id": "S7-b",
        "body": {
          "eyebrow": "The man in the grey cloak",
          "paragraphs": [
            "He is a servant, not a thief by trade, and he knows it. He is on his knees with the vial in his fist and your marked silver in his purse, and he is looking at the gate."
          ]
        },
        "image": "/stories/story-roses-07-grey-cloak.webp",
        "choices": [
          {
            "id": "watch",
            "text": "Call the watch.",
            "result": "The watchmen come with torches and take him, and they take the vial, and by the time the sun is up the agora knows that a hetaira keeps poison in a cedar chest. The Ephors have the vial now. Your name is on the wax.",
            "next": "S8-b-watch"
          },
          {
            "id": "name",
            "text": "His freedom for a name.",
            "result": "\"Who sends you?\" He weighs the gate against you and chooses you. \"The steward of House {house}. He pays for quiet things and asks no questions. I was to bring the blue one tonight.\" You take the vial from his hand and the marked coins from his purse, and you open the gate yourself. A name is worth more than a servant.",
            "next": "S8-b-full",
            "rewards": [
              {
                "type": "gain_good",
                "good": "poison",
                "amount": 1
              },
              {
                "type": "change_drachmae",
                "amount": 20
              }
            ]
          },
          {
            "id": "purse",
            "text": "Vial, purse, and the street.",
            "result": "You take the vial and the whole purse, yours and his, and Kerdon throws him into the lane. He goes without a word, and takes his master's name with him.",
            "next": "S8-b-caught",
            "rewards": [
              {
                "type": "gain_good",
                "good": "poison",
                "amount": 1
              },
              {
                "type": "change_drachmae",
                "amount": 50
              }
            ]
          }
        ]
      },
      {
        "type": "scene",
        "id": "S7-x",
        "body": {
          "eyebrow": "The man in the grey cloak",
          "paragraphs": [
            "He is a servant, not a thief by trade, and he knows it. He is on his knees with the vial in his fist and your marked silver in his purse, and he is looking at the gate."
          ]
        },
        "image": "/stories/story-roses-07-grey-cloak.webp",
        "choices": [
          {
            "id": "watch",
            "text": "Call the watch.",
            "result": "The watchmen come with torches and take him, and they take the vial, and by the time the sun is up the agora knows that a hetaira keeps poison in a cedar chest. The Ephors have the vial now. Your name is on the wax.",
            "next": "S8-x-watch"
          },
          {
            "id": "name",
            "text": "His freedom for a name.",
            "result": "\"Who sends you?\" He weighs the gate against you and chooses you. \"The steward of House {house}. He pays for quiet things and asks no questions. I was to bring the blue one tonight.\" You take the vial from his hand and the marked coins from his purse, and you open the gate yourself. A name is worth more than a servant.",
            "next": "S8-x-full",
            "rewards": [
              {
                "type": "gain_good",
                "good": "poison",
                "amount": 1
              },
              {
                "type": "change_drachmae",
                "amount": 20
              }
            ]
          },
          {
            "id": "purse",
            "text": "Vial, purse, and the street.",
            "result": "You take the vial and the whole purse, yours and his, and Kerdon throws him into the lane. He goes without a word, and takes his master's name with him.",
            "next": "S8-x-caught",
            "rewards": [
              {
                "type": "gain_good",
                "good": "poison",
                "amount": 1
              },
              {
                "type": "change_drachmae",
                "amount": 50
              }
            ]
          }
        ]
      },
      {
        "type": "scene",
        "id": "S8-b-full",
        "body": {
          "eyebrow": "Myrto",
          "paragraphs": [
            "The night is nearly done. Whatever else you found, the two remedies are back on the shelf, from under her bed in the end, wrapped in her shawl, and Myrto is waiting in the courtyard because she has nowhere else to wait."
          ]
        },
        "image": "/stories/story-roses-08-first-light.webp",
        "choices": [
          {
            "id": "keep",
            "text": "Keep her.",
            "result": "\"Your mother's physician will be paid from this house, and you will pay it back from your share, slowly, and you will never again take from this roof what you could have asked for.\" She weeps, which is a waste, and then she kisses your hand, which is not.",
            "next": "S9-b-full",
            "rewards": [
              {
                "type": "gain_good",
                "good": "remedy",
                "amount": 2
              },
              {
                "type": "change_composure",
                "amount": 5
              }
            ]
          },
          {
            "id": "send",
            "text": "Send her away.",
            "result": "You give her the bracelet and her wages to the day and the name of a house in Emporion that will take her. She goes at dawn. The house is a woman short, and the shipowner's son will be sorry.",
            "next": "S9-b-full",
            "rewards": [
              {
                "type": "gain_good",
                "good": "remedy",
                "amount": 2
              }
            ]
          },
          {
            "id": "share",
            "text": "Take it from her share.",
            "result": "\"Two bottles at the physician's price. It comes out of your share until it is paid.\" She agrees because she must. She stays, and she does not forget.",
            "next": "S9-b-full",
            "rewards": [
              {
                "type": "gain_good",
                "good": "remedy",
                "amount": 2
              },
              {
                "type": "change_drachmae",
                "amount": 10
              }
            ]
          }
        ]
      },
      {
        "type": "scene",
        "id": "S8-b-caught",
        "body": {
          "eyebrow": "Myrto",
          "paragraphs": [
            "The night is nearly done. Whatever else you found, the two remedies are back on the shelf, from under her bed in the end, wrapped in her shawl, and Myrto is waiting in the courtyard because she has nowhere else to wait."
          ]
        },
        "image": "/stories/story-roses-08-first-light.webp",
        "choices": [
          {
            "id": "keep",
            "text": "Keep her.",
            "result": "\"Your mother's physician will be paid from this house, and you will pay it back from your share, slowly, and you will never again take from this roof what you could have asked for.\" She weeps, which is a waste, and then she kisses your hand, which is not.",
            "next": "S9-b-caught",
            "rewards": [
              {
                "type": "gain_good",
                "good": "remedy",
                "amount": 2
              },
              {
                "type": "change_composure",
                "amount": 5
              }
            ]
          },
          {
            "id": "send",
            "text": "Send her away.",
            "result": "You give her the bracelet and her wages to the day and the name of a house in Emporion that will take her. She goes at dawn. The house is a woman short, and the shipowner's son will be sorry.",
            "next": "S9-b-caught",
            "rewards": [
              {
                "type": "gain_good",
                "good": "remedy",
                "amount": 2
              }
            ]
          },
          {
            "id": "share",
            "text": "Take it from her share.",
            "result": "\"Two bottles at the physician's price. It comes out of your share until it is paid.\" She agrees because she must. She stays, and she does not forget.",
            "next": "S9-b-caught",
            "rewards": [
              {
                "type": "gain_good",
                "good": "remedy",
                "amount": 2
              },
              {
                "type": "change_drachmae",
                "amount": 10
              }
            ]
          }
        ]
      },
      {
        "type": "scene",
        "id": "S8-b-escaped",
        "body": {
          "eyebrow": "Myrto",
          "paragraphs": [
            "The night is nearly done. Whatever else you found, the two remedies are back on the shelf, from under her bed in the end, wrapped in her shawl, and Myrto is waiting in the courtyard because she has nowhere else to wait."
          ]
        },
        "image": "/stories/story-roses-08-first-light.webp",
        "choices": [
          {
            "id": "keep",
            "text": "Keep her.",
            "result": "\"Your mother's physician will be paid from this house, and you will pay it back from your share, slowly, and you will never again take from this roof what you could have asked for.\" She weeps, which is a waste, and then she kisses your hand, which is not.",
            "next": "S9-b-escaped",
            "rewards": [
              {
                "type": "gain_good",
                "good": "remedy",
                "amount": 2
              },
              {
                "type": "change_composure",
                "amount": 5
              }
            ]
          },
          {
            "id": "send",
            "text": "Send her away.",
            "result": "You give her the bracelet and her wages to the day and the name of a house in Emporion that will take her. She goes at dawn. The house is a woman short, and the shipowner's son will be sorry.",
            "next": "S9-b-escaped",
            "rewards": [
              {
                "type": "gain_good",
                "good": "remedy",
                "amount": 2
              }
            ]
          },
          {
            "id": "share",
            "text": "Take it from her share.",
            "result": "\"Two bottles at the physician's price. It comes out of your share until it is paid.\" She agrees because she must. She stays, and she does not forget.",
            "next": "S9-b-escaped",
            "rewards": [
              {
                "type": "gain_good",
                "good": "remedy",
                "amount": 2
              },
              {
                "type": "change_drachmae",
                "amount": 10
              }
            ]
          }
        ]
      },
      {
        "type": "scene",
        "id": "S8-b-watch",
        "body": {
          "eyebrow": "Myrto",
          "paragraphs": [
            "The night is nearly done. Whatever else you found, the two remedies are back on the shelf, from under her bed in the end, wrapped in her shawl, and Myrto is waiting in the courtyard because she has nowhere else to wait."
          ]
        },
        "image": "/stories/story-roses-08-first-light.webp",
        "choices": [
          {
            "id": "keep",
            "text": "Keep her.",
            "result": "\"Your mother's physician will be paid from this house, and you will pay it back from your share, slowly, and you will never again take from this roof what you could have asked for.\" She weeps, which is a waste, and then she kisses your hand, which is not.",
            "next": "S9-b-watch",
            "rewards": [
              {
                "type": "gain_good",
                "good": "remedy",
                "amount": 2
              },
              {
                "type": "change_composure",
                "amount": 5
              }
            ]
          },
          {
            "id": "send",
            "text": "Send her away.",
            "result": "You give her the bracelet and her wages to the day and the name of a house in Emporion that will take her. She goes at dawn. The house is a woman short, and the shipowner's son will be sorry.",
            "next": "S9-b-watch",
            "rewards": [
              {
                "type": "gain_good",
                "good": "remedy",
                "amount": 2
              }
            ]
          },
          {
            "id": "share",
            "text": "Take it from her share.",
            "result": "\"Two bottles at the physician's price. It comes out of your share until it is paid.\" She agrees because she must. She stays, and she does not forget.",
            "next": "S9-b-watch",
            "rewards": [
              {
                "type": "gain_good",
                "good": "remedy",
                "amount": 2
              },
              {
                "type": "change_drachmae",
                "amount": 10
              }
            ]
          }
        ]
      },
      {
        "type": "scene",
        "id": "S8-x-full",
        "body": {
          "eyebrow": "Myrto",
          "paragraphs": [
            "The night is nearly done. Whatever else you found, the two remedies are back on the shelf, from under her bed in the end, wrapped in her shawl, and Myrto is waiting in the courtyard because she has nowhere else to wait."
          ]
        },
        "image": "/stories/story-roses-08-first-light.webp",
        "choices": [
          {
            "id": "keep",
            "text": "Keep her.",
            "result": "\"Your mother's physician will be paid from this house, and you will pay it back from your share, slowly, and you will never again take from this roof what you could have asked for.\" She weeps, which is a waste, and then she kisses your hand, which is not.",
            "next": "S9-x-full",
            "rewards": [
              {
                "type": "gain_good",
                "good": "remedy",
                "amount": 2
              },
              {
                "type": "change_composure",
                "amount": 5
              }
            ]
          },
          {
            "id": "send",
            "text": "Send her away.",
            "result": "You give her the bracelet and her wages to the day and the name of a house in Emporion that will take her. She goes at dawn. The house is a woman short, and the shipowner's son will be sorry.",
            "next": "S9-x-full",
            "rewards": [
              {
                "type": "gain_good",
                "good": "remedy",
                "amount": 2
              }
            ]
          },
          {
            "id": "share",
            "text": "Take it from her share.",
            "result": "\"Two bottles at the physician's price. It comes out of your share until it is paid.\" She agrees because she must. She stays, and she does not forget.",
            "next": "S9-x-full",
            "rewards": [
              {
                "type": "gain_good",
                "good": "remedy",
                "amount": 2
              },
              {
                "type": "change_drachmae",
                "amount": 10
              }
            ]
          }
        ]
      },
      {
        "type": "scene",
        "id": "S8-x-caught",
        "body": {
          "eyebrow": "Myrto",
          "paragraphs": [
            "The night is nearly done. Whatever else you found, the two remedies are back on the shelf, from under her bed in the end, wrapped in her shawl, and Myrto is waiting in the courtyard because she has nowhere else to wait."
          ]
        },
        "image": "/stories/story-roses-08-first-light.webp",
        "choices": [
          {
            "id": "keep",
            "text": "Keep her.",
            "result": "\"Your mother's physician will be paid from this house, and you will pay it back from your share, slowly, and you will never again take from this roof what you could have asked for.\" She weeps, which is a waste, and then she kisses your hand, which is not.",
            "next": "S9-x-caught",
            "rewards": [
              {
                "type": "gain_good",
                "good": "remedy",
                "amount": 2
              },
              {
                "type": "change_composure",
                "amount": 5
              }
            ]
          },
          {
            "id": "send",
            "text": "Send her away.",
            "result": "You give her the bracelet and her wages to the day and the name of a house in Emporion that will take her. She goes at dawn. The house is a woman short, and the shipowner's son will be sorry.",
            "next": "S9-x-caught",
            "rewards": [
              {
                "type": "gain_good",
                "good": "remedy",
                "amount": 2
              }
            ]
          },
          {
            "id": "share",
            "text": "Take it from her share.",
            "result": "\"Two bottles at the physician's price. It comes out of your share until it is paid.\" She agrees because she must. She stays, and she does not forget.",
            "next": "S9-x-caught",
            "rewards": [
              {
                "type": "gain_good",
                "good": "remedy",
                "amount": 2
              },
              {
                "type": "change_drachmae",
                "amount": 10
              }
            ]
          }
        ]
      },
      {
        "type": "scene",
        "id": "S8-x-escaped",
        "body": {
          "eyebrow": "Myrto",
          "paragraphs": [
            "The night is nearly done. Whatever else you found, the two remedies are back on the shelf, from under her bed in the end, wrapped in her shawl, and Myrto is waiting in the courtyard because she has nowhere else to wait."
          ]
        },
        "image": "/stories/story-roses-08-first-light.webp",
        "choices": [
          {
            "id": "keep",
            "text": "Keep her.",
            "result": "\"Your mother's physician will be paid from this house, and you will pay it back from your share, slowly, and you will never again take from this roof what you could have asked for.\" She weeps, which is a waste, and then she kisses your hand, which is not.",
            "next": "S9-x-escaped",
            "rewards": [
              {
                "type": "gain_good",
                "good": "remedy",
                "amount": 2
              },
              {
                "type": "change_composure",
                "amount": 5
              }
            ]
          },
          {
            "id": "send",
            "text": "Send her away.",
            "result": "You give her the bracelet and her wages to the day and the name of a house in Emporion that will take her. She goes at dawn. The house is a woman short, and the shipowner's son will be sorry.",
            "next": "S9-x-escaped",
            "rewards": [
              {
                "type": "gain_good",
                "good": "remedy",
                "amount": 2
              }
            ]
          },
          {
            "id": "share",
            "text": "Take it from her share.",
            "result": "\"Two bottles at the physician's price. It comes out of your share until it is paid.\" She agrees because she must. She stays, and she does not forget.",
            "next": "S9-x-escaped",
            "rewards": [
              {
                "type": "gain_good",
                "good": "remedy",
                "amount": 2
              },
              {
                "type": "change_drachmae",
                "amount": 10
              }
            ]
          }
        ]
      },
      {
        "type": "scene",
        "id": "S8-x-watch",
        "body": {
          "eyebrow": "Myrto",
          "paragraphs": [
            "The night is nearly done. Whatever else you found, the two remedies are back on the shelf, from under her bed in the end, wrapped in her shawl, and Myrto is waiting in the courtyard because she has nowhere else to wait."
          ]
        },
        "image": "/stories/story-roses-08-first-light.webp",
        "choices": [
          {
            "id": "keep",
            "text": "Keep her.",
            "result": "\"Your mother's physician will be paid from this house, and you will pay it back from your share, slowly, and you will never again take from this roof what you could have asked for.\" She weeps, which is a waste, and then she kisses your hand, which is not.",
            "next": "S9-x-watch",
            "rewards": [
              {
                "type": "gain_good",
                "good": "remedy",
                "amount": 2
              },
              {
                "type": "change_composure",
                "amount": 5
              }
            ]
          },
          {
            "id": "send",
            "text": "Send her away.",
            "result": "You give her the bracelet and her wages to the day and the name of a house in Emporion that will take her. She goes at dawn. The house is a woman short, and the shipowner's son will be sorry.",
            "next": "S9-x-watch",
            "rewards": [
              {
                "type": "gain_good",
                "good": "remedy",
                "amount": 2
              }
            ]
          },
          {
            "id": "share",
            "text": "Take it from her share.",
            "result": "\"Two bottles at the physician's price. It comes out of your share until it is paid.\" She agrees because she must. She stays, and she does not forget.",
            "next": "S9-x-watch",
            "rewards": [
              {
                "type": "gain_good",
                "good": "remedy",
                "amount": 2
              },
              {
                "type": "change_drachmae",
                "amount": 10
              }
            ]
          }
        ]
      },
      {
        "type": "scene",
        "id": "S9-b-full",
        "body": {
          "eyebrow": "Bion and the keys",
          "paragraphs": [
            "First light. Bion is at the gate with the ring of keys in his hand, waiting to hear what becomes of them."
          ]
        },
        "image": "/stories/story-roses-09-gate.webp",
        "choices": [
          {
            "id": "locks",
            "text": "New locks, from his wages.",
            "result": "He agrees before you finish the sentence. \"And no wine at the door, mistress. Water.\" The smith comes at noon.",
            "next": "END-full",
            "rewards": [
              {
                "type": "change_composure",
                "amount": 5
              }
            ]
          },
          {
            "id": "shame",
            "text": "He keeps the key and the shame.",
            "result": "You leave the key on his belt. He understands what that means, and it is heavier than any lock.",
            "next": "END-full"
          }
        ]
      },
      {
        "type": "scene",
        "id": "S9-b-caught",
        "body": {
          "eyebrow": "Bion and the keys",
          "paragraphs": [
            "First light. Bion is at the gate with the ring of keys in his hand, waiting to hear what becomes of them."
          ]
        },
        "image": "/stories/story-roses-09-gate.webp",
        "choices": [
          {
            "id": "locks",
            "text": "New locks, from his wages.",
            "result": "He agrees before you finish the sentence. \"And no wine at the door, mistress. Water.\" The smith comes at noon.",
            "next": "END-caught",
            "rewards": [
              {
                "type": "change_composure",
                "amount": 5
              }
            ]
          },
          {
            "id": "shame",
            "text": "He keeps the key and the shame.",
            "result": "You leave the key on his belt. He understands what that means, and it is heavier than any lock.",
            "next": "END-caught"
          }
        ]
      },
      {
        "type": "scene",
        "id": "S9-b-escaped",
        "body": {
          "eyebrow": "Bion and the keys",
          "paragraphs": [
            "First light. Bion is at the gate with the ring of keys in his hand, waiting to hear what becomes of them."
          ]
        },
        "image": "/stories/story-roses-09-gate.webp",
        "choices": [
          {
            "id": "locks",
            "text": "New locks, from his wages.",
            "result": "He agrees before you finish the sentence. \"And no wine at the door, mistress. Water.\" The smith comes at noon.",
            "next": "END-escaped",
            "rewards": [
              {
                "type": "change_composure",
                "amount": 5
              }
            ]
          },
          {
            "id": "shame",
            "text": "He keeps the key and the shame.",
            "result": "You leave the key on his belt. He understands what that means, and it is heavier than any lock.",
            "next": "END-escaped"
          }
        ]
      },
      {
        "type": "scene",
        "id": "S9-b-watch",
        "body": {
          "eyebrow": "Bion and the keys",
          "paragraphs": [
            "First light. Bion is at the gate with the ring of keys in his hand, waiting to hear what becomes of them."
          ]
        },
        "image": "/stories/story-roses-09-gate.webp",
        "choices": [
          {
            "id": "locks",
            "text": "New locks, from his wages.",
            "result": "He agrees before you finish the sentence. \"And no wine at the door, mistress. Water.\" The smith comes at noon.",
            "next": "END-watch",
            "rewards": [
              {
                "type": "change_composure",
                "amount": 5
              }
            ]
          },
          {
            "id": "shame",
            "text": "He keeps the key and the shame.",
            "result": "You leave the key on his belt. He understands what that means, and it is heavier than any lock.",
            "next": "END-watch"
          }
        ]
      },
      {
        "type": "scene",
        "id": "S9-x-full",
        "body": {
          "eyebrow": "Bion and the keys",
          "paragraphs": [
            "First light. Bion is at the gate with his bundle over his shoulder."
          ]
        },
        "image": "/stories/story-roses-09-gate.webp",
        "choices": [
          {
            "id": "let-go",
            "text": "Let him go.",
            "result": "He leaves with his bundle at first light and does not look back at the house he kept for twenty years. The new steward will be honest for a month.",
            "next": "END-full"
          },
          {
            "id": "stay",
            "text": "Ask him to stay.",
            "result": "You find him with his bundle tied and you say the word you do not say. He unties the bundle. He does not forgive you. He stays, which is more useful.",
            "next": "END-full",
            "rewards": [
              {
                "type": "change_composure",
                "amount": -5
              }
            ]
          }
        ]
      },
      {
        "type": "scene",
        "id": "S9-x-caught",
        "body": {
          "eyebrow": "Bion and the keys",
          "paragraphs": [
            "First light. Bion is at the gate with his bundle over his shoulder."
          ]
        },
        "image": "/stories/story-roses-09-gate.webp",
        "choices": [
          {
            "id": "let-go",
            "text": "Let him go.",
            "result": "He leaves with his bundle at first light and does not look back at the house he kept for twenty years. The new steward will be honest for a month.",
            "next": "END-caught"
          },
          {
            "id": "stay",
            "text": "Ask him to stay.",
            "result": "You find him with his bundle tied and you say the word you do not say. He unties the bundle. He does not forgive you. He stays, which is more useful.",
            "next": "END-caught",
            "rewards": [
              {
                "type": "change_composure",
                "amount": -5
              }
            ]
          }
        ]
      },
      {
        "type": "scene",
        "id": "S9-x-escaped",
        "body": {
          "eyebrow": "Bion and the keys",
          "paragraphs": [
            "First light. Bion is at the gate with his bundle over his shoulder."
          ]
        },
        "image": "/stories/story-roses-09-gate.webp",
        "choices": [
          {
            "id": "let-go",
            "text": "Let him go.",
            "result": "He leaves with his bundle at first light and does not look back at the house he kept for twenty years. The new steward will be honest for a month.",
            "next": "END-escaped"
          },
          {
            "id": "stay",
            "text": "Ask him to stay.",
            "result": "You find him with his bundle tied and you say the word you do not say. He unties the bundle. He does not forgive you. He stays, which is more useful.",
            "next": "END-escaped",
            "rewards": [
              {
                "type": "change_composure",
                "amount": -5
              }
            ]
          }
        ]
      },
      {
        "type": "scene",
        "id": "S9-x-watch",
        "body": {
          "eyebrow": "Bion and the keys",
          "paragraphs": [
            "First light. Bion is at the gate with his bundle over his shoulder."
          ]
        },
        "image": "/stories/story-roses-09-gate.webp",
        "choices": [
          {
            "id": "let-go",
            "text": "Let him go.",
            "result": "He leaves with his bundle at first light and does not look back at the house he kept for twenty years. The new steward will be honest for a month.",
            "next": "END-watch"
          },
          {
            "id": "stay",
            "text": "Ask him to stay.",
            "result": "You find him with his bundle tied and you say the word you do not say. He unties the bundle. He does not forgive you. He stays, which is more useful.",
            "next": "END-watch",
            "rewards": [
              {
                "type": "change_composure",
                "amount": -5
              }
            ]
          }
        ]
      },
      {
        "type": "terminal",
        "id": "END-full",
        "body": {
          "paragraphs": [
            "The night the House of Roses caught its thief. The vial came home, and so did a name.",
            "The steward of House {house} is buying poison."
          ]
        },
        "chronicle": [
          "The night the House of Roses caught its thief. The vial came home, and so did a name.",
          "The steward of House {house} is buying poison."
        ],
        "rewards": []
      },
      {
        "type": "terminal",
        "id": "END-caught",
        "body": {
          "paragraphs": [
            "The night the House of Roses caught its thief. The vial came home; the man's name went with him."
          ]
        },
        "chronicle": [
          "The night the House of Roses caught its thief. The vial came home; the man's name went with him."
        ],
        "rewards": []
      },
      {
        "type": "terminal",
        "id": "END-escaped",
        "body": {
          "paragraphs": [
            "The night a grey cloak went over the gate of the House of Roses and left a blue vial on the stones."
          ]
        },
        "chronicle": [
          "The night a grey cloak went over the gate of the House of Roses and left a blue vial on the stones."
        ],
        "rewards": []
      },
      {
        "type": "terminal",
        "id": "END-watch",
        "body": {
          "paragraphs": [
            "The night the watch took a man and a vial from the House of Roses, and the agora talked until the Artemisia."
          ]
        },
        "chronicle": [
          "The night the watch took a man and a vial from the House of Roses, and the agora talked until the Artemisia."
        ],
        "rewards": [
          {
            "type": "change_composure",
            "amount": -5
          },
          {
            "type": "change_stat",
            "stat": "prestige",
            "amount": -3
          }
        ]
      }
    ]
  }
}
```

END OF PROMPT
