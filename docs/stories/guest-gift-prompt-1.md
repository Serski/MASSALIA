# A Guest-Gift, prompt 1: a story for the Three Hundred

## What this builds

A seventh story: A Guest-Gift, a short one-sitting story offered to every character who holds a seat among the Three Hundred. The night before the Chamber decides the inner-quay berths, Philokles of Chios brings twenty jars of wine as a guest-gift and a purse "for a friend". Three scenes, three endings, 27 paths: the first two steps are colour, the third chooses the reward.

The Story Engine has no trigger for seat-holders, so this is two commits: a `seat` trigger in the server, then the content (the story file, three images, a "Wine" label, the registry line and tests). No migration, no client or stylesheet change.

Rulings (Argiris):

- The story is offered to every character holding a seat among the Three Hundred, of any class, from the deploy with no opening date, and to anyone who takes a seat later. A run started while seated stays listed and can be finished if the seat is later lost.
- Seat-holding is read from `player_characters.is_councilor`. The seat purchase sets it in the same transaction as the seat row (`oligarchy.ts:112`), a fresh succession clears it, and a dynastic heir keeps it with the seat. Slaves can never hold a seat.
- Rewards: naming the offer gives prestige +3; keeping the gift gives 20 wine; taking the purse gives 100 drachmae and prestige -3. Nothing else carries a reward or a gate.
- `goodLabels` gains `"wine": "Wine"`, so the reward strip (and the Market) name it properly.
- The text is second person with no gendered word for the player, since a Hetaira can hold a seat. The images show no part of the player.
- `{house}` appears once, in Step 2, as in The House of Roses.
- The offer card shows the opening image, as the other stories do.
- The images come from `/Users/macbook/Desktop/MoOli`.

## Phase 0: recon (no code)

Confirm each reference at HEAD (2c57615 or later). If any is not as described, or the images do not map one to one onto the three targets, STOP 0 with the mismatch before writing anything.

- `apps/server/src/services/story.ts`: `StoryTrigger` (69-75, the `dated` variant last at 75); `STORY_TRIGGERS` (76-88, `bronze-left-behind` at 87); in `availableStories` (506), the character read runs only when the registry holds a `class` or `dated` trigger (521) and selects `classId` and the world's `startedAt`; the `class` and `dated` branches end in `continue`, and everything after them (568 on) is the festival fallthrough.
- `packages/db/src/schema.ts:253`: `is_councilor` on `player_characters`. `apps/server/src/services/oligarchy.ts`: the buy refuses slaves (79) and sets `isCouncilor: true` in the purchase transaction (112).
- `apps/server/src/services/story.test.ts`: `createCharacter(name, classId = "trader")` (168), the `class-story` fixture titled "The House of Fixtures" with its image, `REG_DATED` (205), and the last test is 35.
- `apps/server/src/services/story-content.test.ts`: `bronzeFile` at 17, `buildingsFile` among the constants, the last pure test is 27 and the seed block ends with 28.
- `content/buildings/buildings.json`: `vendor` has `wine`; `goodLabels` (592-602) has no `wine` and ends with `"remedy": "Remedy"`.
- The top level of MoOli: every file's name, format, pixel size and bytes. The three site WebPs map to the targets below. Each must be WebP at 1134x638 under 200,000 bytes; any that is not is a STOP 0 (do not re-encode). Masters and anything else stay on the Desktop.

| Target under `apps/web/public/stories/` | Source in `MoOli` | Node |
|---|---|---|
| `story-guest-00-door.webp` | `GuestGift-00-Door.webp` | S1, and the offer card |
| `story-guest-01-offer.webp` | `GuestGift-01-Offer.webp` | S2 |
| `story-guest-02-chamber.webp` | `GuestGift-02-Chamber.webp` | S3 |

## Commit 1: `server: a story trigger for the Three Hundred, every seat-holder`

1. Save this prompt verbatim as `docs/stories/guest-gift-prompt-1.md`.
2. `apps/server/src/services/story.ts`:
   - `StoryTrigger` gains `| { kind: "seat" }`, with a comment: offered to every character holding a seat among the Three Hundred (`player_characters.is_councilor`), with no date; a run started while seated stays listed if the seat is later lost.
   - In `availableStories`, the character read also runs when the registry holds a `seat` trigger, and also selects `isCouncilor`.
   - A `seat` branch after the `dated` branch and before the festival fallthrough: with no progress row, skip unless `character?.isCouncilor`; otherwise the same `storyCard` read and `offered` entry as the `class` branch, then `continue`.
   - No registry entry in this commit.
3. `apps/server/src/services/story.test.ts`, with `REG_SEAT = { "class-story": { kind: "seat" as const } }` beside `REG_DATED`:
   - 36: a trader with `is_councilor` false gets `[]`; set to true, the same call offers `class-story` with its title and image; a Hetaira with `is_councilor` true is offered it too.
   - 37: a seated character who starts the story and then has `is_councilor` set to false still sees it listed `active`; a second character who loses his seat before starting is no longer offered it.

## Commit 2: `content: A Guest-Gift, a story for the Three Hundred, with its three images`

1. `content/stories/guest-gift.json`: extract the JSON block under "The story file" at the end of `docs/stories/guest-gift-prompt-1.md` with a script (the text between the opening json fence and its closing fence, plus one final newline), write it byte for byte, and confirm it parses. Never retype it. Its sha256 with the final newline is `39fa61d4e9d4b039ef491d16e82f901c603f19255c9676a6a3eceb22d63b67bf` (6,461 bytes).
2. The three images, copied as is to the target names.
3. `content/buildings/buildings.json`: `goodLabels` gains `"wine": "Wine"` after `"remedy": "Remedy"`. No other change to that file.
4. `STORY_TRIGGERS` gains, after `bronze-left-behind`, the comment `// No opening date: every seat-holder among the Three Hundred, and anyone who takes a seat later.` and the line `"guest-gift": { kind: "seat" },`.
5. `apps/server/src/services/story-content.test.ts`: a `guestFile` constant after `bronzeFile`, and an "A Guest-Gift story content integrity (pure)" block after the Bronze Left Behind block, in the same idiom:
   - 29: the file parses and `validateStoryGraph` returns `[]`.
   - 30: start `S1`; 6 nodes, 3 scenes and 3 terminals; S1, S2 and S3 carry `story-guest-00-door.webp`, `story-guest-01-offer.webp` and `story-guest-02-chamber.webp` in that order; the terminals are exactly `END-named`, `END-gift` and `END-purse`, each with its `chronicle` equal to its `paragraphs`; `{house}` appears only in S2's paragraph.
   - 31: rewards and gates exactly: `name` gives prestige +3; `gift` gives `gain_good` wine 20; `purse` gives `change_drachmae` 100 and prestige -3. No other choice, fallback or terminal carries a reward, and no choice has `requires`. Every `gain_good` good has a `goodLabels` entry, and `wine` reads "Wine".
   - 32: an exhaustive walk from `S1` finds 27 paths, 9 at each ending.
   - In the DB-gated seed block, 33: `loadStories` also upserts `guest-gift` at version 1 with 6 nodes, and `STORY_TRIGGERS["guest-gift"]` equals `{ kind: "seat" }`.
   - The existing image test (5) covers the three files.

## Gate and STOP 1

`DATABASE_URL=…/massalia_test pnpm gate` at HEAD after the last commit, ending `GATE GREEN … tree clean`. No push. Report:

- Committed: both SHAs and titles
- Gate: <the gate's last line>, with the server and db suites' test counts and 0 skipped
- Story file: bytes and sha256 (expected above)
- Images: target <- source, pixel size, bytes, for all three
- Deviations: each as a ruling for Argiris, or "none"
- Post-deploy checks:
  select id, version, jsonb_array_length(tree->'nodes') from stories where id = 'guest-gift';   -- 1 row, version 1, 6
  on a seat-holder, right after the deploy: the Court shows the A Guest-Gift offer card with the opening image; a character without a seat sees no card

## Scope fence

Do not touch: the other six story files and their registry entries; `packages/shared/src/story.ts`; `story.ts` beyond the trigger type, the character read, the `seat` branch and the one registry entry; `oligarchy.ts` and the seat rules; `buildings.json` beyond the one label; the client, the Chronicle code and the Market; any other content file, stylesheet or copy. No migration. No refactors along the way. Nothing else from MoOli enters the repo.

## The story file

```json
{
  "id": "guest-gift",
  "version": 1,
  "tree": {
    "title": "A Guest-Gift",
    "start": "S1",
    "nodes": [
      {
        "type": "scene",
        "id": "S1",
        "body": {
          "eyebrow": "A caller at dusk",
          "paragraphs": [
            "Tomorrow the Three Hundred decide who gets the three free berths on the inner quay of the Lakydon. Tonight a stranger is at your door: Philokles of Chios, a wine shipper, with a slave behind him carrying a sealed jar. He knows your name and your seat. \"A cup of my wine and a quarter of an hour. I ask nothing else tonight.\""
          ]
        },
        "image": "/stories/story-guest-00-door.webp",
        "choices": [
          {
            "id": "courtyard",
            "text": "Receive him in the courtyard.",
            "result": "A lamp is lit and two cups brought. The wine is dark and old and better than anything in your own cellar, which he knows.",
            "next": "S2"
          },
          {
            "id": "steward",
            "text": "Receive him with your steward present.",
            "result": "Your steward stands by the door with his tablet. Philokles smiles at him as if he were furniture, and pours.",
            "next": "S2"
          },
          {
            "id": "wait",
            "text": "Keep him waiting an hour.",
            "result": "He waits the hour in the street without sitting down. When he is brought in he thanks you for your time as though you had given it gladly.",
            "next": "S2"
          }
        ]
      },
      {
        "type": "scene",
        "id": "S2",
        "body": {
          "eyebrow": "The offer",
          "paragraphs": [
            "He puts it plainly, as merchants do when they have rehearsed. A berth on the inner quay would save his ships three days of lightering on every voyage. In his cart outside are twenty jars of this vintage, and in his belt is a purse. \"The wine is a guest-gift, and yours whatever you decide. The purse is a hundred drachmae, and it is for a friend. Your colleague of House {house} did not send me away.\""
          ]
        },
        "image": "/stories/story-guest-01-offer.webp",
        "choices": [
          {
            "id": "buys",
            "text": "Ask what the purse buys.",
            "result": "\"One voice, raised once, tomorrow. Nothing one of the Three Hundred does not do every day for nothing.\"",
            "next": "S3"
          },
          {
            "id": "who",
            "text": "Ask who else has drunk his wine.",
            "result": "He names no one else. He does not need to: the cart outside holds more jars than one house could drink.",
            "next": "S3"
          },
          {
            "id": "silence",
            "text": "Say nothing, and let him fill the silence.",
            "result": "He fills it. Merchants cannot bear silence. By the time he stops, you know what the berth is worth to him, and it is a great deal more than a hundred drachmae.",
            "next": "S3"
          }
        ]
      },
      {
        "type": "scene",
        "id": "S3",
        "body": {
          "eyebrow": "The Three Hundred",
          "paragraphs": [
            "Morning. The Chamber fills. The berths come up third, after the grain accounts. Philokles stands at the back among the petitioners and does not look at you."
          ]
        },
        "image": "/stories/story-guest-02-chamber.webp",
        "choices": [
          {
            "id": "name",
            "text": "Rise and name the offer before the Chamber.",
            "result": "You say it plainly: the hour, the purse, the sum. The Chamber is silent, and then it is not. Philokles is gone before you sit down, and his cart goes back to his ship unopened. For a season, yours is the name people use when they mean a seat that cannot be bought.",
            "next": "END-named",
            "rewards": [
              {
                "type": "change_stat",
                "stat": "prestige",
                "amount": 3
              }
            ]
          },
          {
            "id": "gift",
            "text": "Keep the wine, send back the purse, and vote as you judge.",
            "result": "A guest-gift is a guest-gift; your grandfather took them, and so did his. The purse goes back by your steward before the session. You vote as you would have voted, and twenty jars go down into your cellar.",
            "next": "END-gift",
            "rewards": [
              {
                "type": "gain_good",
                "good": "wine",
                "amount": 20
              }
            ]
          },
          {
            "id": "purse",
            "text": "Take the purse and speak for his berth.",
            "result": "You speak for him, briefly and well, and he gets his berth. The purse is the right weight. The wine goes back to his ship, because someone who is paid is not also a guest. By evening the fish stalls know what your voice costs.",
            "next": "END-purse",
            "rewards": [
              {
                "type": "change_drachmae",
                "amount": 100
              },
              {
                "type": "change_stat",
                "stat": "prestige",
                "amount": -3
              }
            ]
          }
        ]
      },
      {
        "type": "terminal",
        "id": "END-named",
        "body": {
          "paragraphs": [
            "The day a Chian's purse was named aloud before the Three Hundred."
          ]
        },
        "chronicle": [
          "The day a Chian's purse was named aloud before the Three Hundred."
        ],
        "rewards": []
      },
      {
        "type": "terminal",
        "id": "END-gift",
        "body": {
          "paragraphs": [
            "The day twenty jars of Chian wine came as a guest-gift, and the purse went back."
          ]
        },
        "chronicle": [
          "The day twenty jars of Chian wine came as a guest-gift, and the purse went back."
        ],
        "rewards": []
      },
      {
        "type": "terminal",
        "id": "END-purse",
        "body": {
          "paragraphs": [
            "The day a berth on the inner quay was bought for a hundred drachmae."
          ]
        },
        "chronicle": [
          "The day a berth on the inner quay was bought for a hundred drachmae."
        ],
        "rewards": []
      }
    ]
  }
}
```

END OF PROMPT
