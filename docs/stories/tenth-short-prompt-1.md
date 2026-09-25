# A Tenth Short, prompt 1: a class-triggered story for the Landowner

## What this builds

A fifth story beside The Silver of Artemis, The House of Roses, River Nails and News from Neapolis: A Tenth Short, a one-sitting story offered to every Landowner. The grain wardens count the player's last three wagons a tenth short, and the agora calls it theft from the city's bread. Over one night he finds the truth: the granary clerk Hipponax fills a bronze measure beaten out at the belly, paid by a rival house's steward, while his own carter Drakon skims a sack a trip on the side. Nine steps after the opening, two or three choices each, four endings.

The Story Engine already has everything the script needs: `requires` with `otherwise` fallbacks, priced choices, the class trigger, the `{house}` token and Chronicle lines on terminals. This prompt is content only: the story file, its ten images, one registry line and tests, in one commit. No engine, client or stylesheet change. No migration.

Rulings (Argiris, 25 Sept 2026):

- The story is offered to every character of class `landowner` at once, from the deploy, with no opening date. A Landowner created later is offered it from his first dashboard load. The offer is read lazily on dashboard load.
- There is no prestige gate. Every check is composure 50 with a fallback (the script's Fail line), so no choice is ever shown locked for a stat, and a new Landowner (composure 70) passes all of them. The two paid choices (Kallisto 5 drachmae, Hipponax 10) show their price and lock when the purse cannot cover them.
- Rewards are drachmae and stats only: no goods, no composure. The amounts are in the story file below: the public ending 55 drachmae and prestige +2, the name ending 45 and intelligence +2, the quiet ending 90 and prestige -1, the unproven ending -20 and prestige -2; Drakon docked 15, the boundary-stone oath devotion +1; the renewed contract 10 and prestige +1, the Emporion sale 35; asking a blamed Philinos to stay prestige -1. Over every path the drachmae run from -35 to 140.
- Every Landowner is male (character creation). The text never addresses the player or gives him a pronoun, and the images show him.
- `{house}` appears on the name path only (the `name` result at Step 7 and the name ending's second Chronicle line), picked as for The House of Roses.
- Every ending writes its Chronicle line; the name ending also writes the intel line.
- The offer card in the Court panel shows the opening image, as the other stories do.
- The images come from `/Users/macbook/Desktop/TenthShort`.

## The node scheme

- `S3-`, `S4-`, `S5-<k|x>`: Philinos kept (`k`) or blamed (`x`) at S2. `press` (on either branch) and `bread` keep him; `blame` loses him.
- `S6-<k|x>-<p|w>`: Hipponax pressed (`p`: `threaten` passed, or `buy`) or only warned (`w`: `warn`, or `threaten` failed).
- At S6, `temple` proves on a pass and falls back to `S8-<k|x>-unproven`; `pour` proves for `k`, and for `x` is a composure check with the same fallback; `clerk` proves for `p` and goes to `S8-<k|x>-unproven` for `w`.
- `S7-<k|x>`: proven. Its three choices carry the ending's rewards and lead to `S8-<k|x>-<public|name|quiet>`.
- `S8-` and `S9-<k|x>-<public|name|quiet|unproven>`; each `S9-` leads to `END-<outcome>`.
- Terminals: `END-public`, `END-name`, `END-quiet`, `END-unproven`. Only `END-unproven` carries rewards (the penalty).

## Phase 0: recon (no code)

Confirm each reference at HEAD. If any is not as described, or the images do not map one to one onto the ten targets below, STOP 0 with the mismatch before writing anything.

- `apps/server/src/services/story.ts`: `StoryTrigger` (69-74, the `class` variant's `opensAt` optional at 71) and `STORY_TRIGGERS` (76-84, `samnite-war` at 83); `loadStories` (92) reads every `.json` in `content/stories`, so the new file needs no loader change; `summarizeRewards` (274) maps `change_drachmae` and `change_stat`; the class branch of `availableStories` (546-552) skips the date check when `opensAt` is absent, so the story is offered at once.
- `packages/shared/src/story.ts`: `StoryRequirement`, `requires` and `otherwise` on `StoryChoice`, `chronicle` on a terminal, `validateStoryGraph`.
- `packages/shared/src/character.ts:12`: the class id is `landowner`.
- `apps/server/src/services/story-content.test.ts`: the file constants (13-17), tests 1 to 16 in the pure blocks (the House of Roses walk is test 9, River Nails 11 to 16, the image test 5 checks every image path in every story file), and the DB-gated seed block with tests 3, 10, 17 and 18 (18 ends the file).
- `apps/web/public/stories/`: the `story-roses-*` files are WebP at 1134×638.
- List `/Users/macbook/Desktop/TenthShort`: every file's name, format, pixel size and bytes. Map the ten site WebPs to the targets below by name; any other file (prompt notes, zips, masters) stays out of the repo. A source that is not WebP at 1134×638 under 200 KB needs an encoder: name it (`cwebp`, or Python Pillow with WebP support), install nothing into the repo; none available is a STOP 0.

| Target under `apps/web/public/stories/` | Source in `TenthShort` | Node(s) |
|---|---|---|
| `story-tenth-00-opening.webp` | `TenthShort-00-Opening.webp` | OPEN, and the offer card |
| `story-tenth-01-yard.webp` | `TenthShort-01-Yard.webp` | S1 |
| `story-tenth-02-philinos.webp` | `TenthShort-02-Philinos.webp` | S2 |
| `story-tenth-03-drakon.webp` | `TenthShort-03-Drakon.webp` | S3-* |
| `story-tenth-04-kallisto.webp` | `TenthShort-04-Kallisto.webp` | S4-* |
| `story-tenth-05-hipponax.webp` | `TenthShort-05-Hipponax.webp` | S5-* |
| `story-tenth-06-measuring.webp` | `TenthShort-06-Measuring.webp` | S6-* |
| `story-tenth-07-clerk.webp` | `TenthShort-07-Clerk.webp` | S7-* |
| `story-tenth-08-stone.webp` | `TenthShort-08-Stone.webp` | S8-* |
| `story-tenth-09-contract.webp` | `TenthShort-09-Contract.webp` | S9-* |

The terminals carry no image.

## Phase 1: the story (one commit)

### Commit 1: `content: A Tenth Short, a Landowner story, with its ten images`

1. Save this prompt verbatim as `docs/stories/tenth-short-prompt-1.md`.
2. `content/stories/tenth-short.json`: extract the JSON block under "The story file" at the end of `docs/stories/tenth-short-prompt-1.md` with a script (the text between the ```` ```json ```` fence and its closing fence), write it byte for byte, and confirm it parses. Never retype it.
3. The ten images at the target names above: a source that is already WebP at 1134×638 and under 200 KB is copied as is; any other is encoded to WebP 1134 px wide, height by its aspect ratio (no crop), quality about 82, under 200 KB.
4. `STORY_TRIGGERS` gains, after `samnite-war`:
   ```ts
   // No opening date: every Landowner at once, and a new one from his first day.
   "tenth-short": { kind: "class", classId: "landowner" },
   ```
5. `apps/server/src/services/story-content.test.ts`: a `tenthFile` constant beside `riverFile`, and an "A Tenth Short story content integrity (pure)" block after the River Nails block, in the same idiom:
   - 19: the file parses and `validateStoryGraph` returns `[]`.
   - 20: start `OPEN`; 35 nodes, 31 scenes and 4 terminals; the terminals are exactly `END-public`, `END-name`, `END-quiet` and `END-unproven`, and each one's `chronicle` equals its `paragraphs`; `END-name` has two lines and only its second holds `{house}`.
   - 21: rewards and gates. The only reward types anywhere (choices, fallbacks, terminals) are `change_drachmae` and `change_stat` on `prestige`, `intelligence` or `devotion`. Every `requires` is either `{ composure: 50 }` with an `otherwise`, or `{ drachmae: 5 }` or `{ drachmae: 10 }` without one, the latter two each paired with a `change_drachmae` of minus the same amount on that choice. No choice requires prestige.
   - 22: an exhaustive walk from `OPEN`, following every choice and every `otherwise` branch and summing drachmae and prestige as test 9 does, finds 31,968 paths: 8,640 each at `END-public`, `END-name` and `END-quiet`, and 6,048 at `END-unproven`. A path ends at `END-name` exactly when it took `name`. Drachmae totals run from −35 to 140, prestige totals from −3 to 3.
   - In the DB-gated seed block, 23: `loadStories` also upserts `tenth-short` at version 1 with 35 nodes, and `STORY_TRIGGERS["tenth-short"]` equals `{ kind: "class", classId: "landowner" }`.
   - The existing image test (5) covers the ten files.

## Gate and STOP 1

`DATABASE_URL=…/massalia_test pnpm gate` at HEAD after the commit, ending `GATE GREEN … tree clean`. No push. Report:

```
Committed: <SHA> content: A Tenth Short, a Landowner story, with its ten images
Gate: <the gate's last line>, with the server and db suites' test counts and 0 skipped
Story file: <bytes>, equal to the fenced block (say whether a final newline was added)
Images: <target <- source, copied or encoded (encoder), pixel size, bytes, for all ten>
Deviations: <each as a ruling for Argiris, or "none">
Post-deploy checks:
  select id, version, jsonb_array_length(tree->'nodes') from stories where id = 'tenth-short';   -- 1 row, version 1, 35
  on a Landowner, right after the deploy: the Court shows the A Tenth Short offer card with the opening image; a non-Landowner sees no card
  select status, count(*) from story_progress where story_id = 'tenth-short' group by status;
```

## Scope fence

Do not touch: the other four story files and their registry entries; `packages/shared/src/story.ts`; `apps/server/src/services/story.ts` beyond the one registry entry; `StorySheet.tsx`, `CourtPanel.tsx` and the Chronicle code; the events, festivals, market, barracks and worker; any other content file; any stylesheet; any guide, news or copy. No migration. No balance numbers beyond those in the story file. No refactors along the way. Everything in `TenthShort` other than the ten site WebPs stays on the Desktop.

## The story file

```json
{
  "id": "tenth-short",
  "version": 1,
  "tree": {
    "title": "A Tenth Short",
    "start": "OPEN",
    "nodes": [
      {
        "type": "scene",
        "id": "OPEN",
        "body": {
          "paragraphs": [
            "A boy has come out from the city with a wax tablet from the grain wardens. Your last three wagons of wheat went into the city's granary yesterday, and by the wardens' count every one of them was a tenth short of the tally your steward signed.",
            "Short wheat on a city contract is theft from the city's bread. By noon the agora had a name for it, and the name was yours. Someone at the fish stalls was asking, loudly, whether a landowner who cheats the granary should be let near it again.",
            "The wardens measure your next wagons at dawn. You have tonight."
          ]
        },
        "image": "/stories/story-tenth-00-opening.webp",
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
            "The house is quiet and the hands have eaten. Where do you begin?"
          ]
        },
        "image": "/stories/story-tenth-01-yard.webp",
        "choices": [
          {
            "id": "tablets",
            "text": "The tally tablets.",
            "result": "Philinos's wax tablets are in their case, in his careful hand: sacks counted at the threshing floor, sacks counted onto the wagons, the same numbers twice. Either the old man is lying twice, or the wheat left here whole.",
            "next": "S2"
          },
          {
            "id": "barns",
            "text": "The barns.",
            "result": "You take the lamp through the barns. The floor is swept and the empty sacks are folded and counted. Seventy sacks went out and seventy came back empty. Whatever happened to your wheat happened after the gate.",
            "next": "S2"
          },
          {
            "id": "household",
            "text": "The whole household.",
            "result": "You call them into the yard. The hands stand with their hats in their hands and say what hands say. Drakon the carter, who drove the wagons, laughs a little too loud at nothing. Philinos watches him laugh.",
            "next": "S2"
          }
        ]
      },
      {
        "type": "scene",
        "id": "S2",
        "body": {
          "eyebrow": "Philinos",
          "paragraphs": [
            "Philinos has kept your fields since your father's time. He counts everything twice and trusts nothing he has not counted, and tonight he looks like a man who has counted his own life and found it short. He is waiting at the barn door with his tablets under his arm."
          ]
        },
        "image": "/stories/story-tenth-02-philinos.webp",
        "choices": [
          {
            "id": "press",
            "text": "Press him.",
            "requires": {
              "composure": 50
            },
            "result": "\"The three wagons. Were they full when they left?\" He does not look at his tablets. \"Full to the knot. I tied the last ones myself. And I will tell you what I have not told the wardens. At the granary the clerk would not let me watch the measuring. He sent me outside to wait. In twenty years that has never happened.\"",
            "next": "S3-k",
            "otherwise": {
              "result": "You mean to ask it calmly and it comes out as a charge. He answers only what you asked, \"Full, every sack,\" and closes his tablets. He is still yours tonight, but he will offer you nothing you do not ask for.",
              "next": "S3-k"
            }
          },
          {
            "id": "bread",
            "text": "Share his bread.",
            "result": "You sit on the barn step and share his bread and let him talk about your father's harvests until he gets to yesterday. \"Full, every sack. But the clerk would not let me watch them measured. In twenty years he always let me watch.\"",
            "next": "S3-k"
          },
          {
            "id": "blame",
            "text": "Blame him.",
            "result": "\"You signed for wheat that was not there.\" He sets the tablets down on the step very carefully, as if they might break. \"Then the tablets are yours,\" he says, and goes to his hut, and the lamp there goes out. Whatever else happens tonight, you have lost the one man who knows every sack.",
            "next": "S3-x"
          }
        ]
      },
      {
        "type": "scene",
        "id": "S3-k",
        "body": {
          "eyebrow": "Drakon",
          "paragraphs": [
            "Drakon drives your wagons to the city and back. He was a slave until your father freed him. He is good with mules and bad with money, and tonight he has a new cloak with a Gaulish pin."
          ]
        },
        "image": "/stories/story-tenth-03-drakon.webp",
        "choices": [
          {
            "id": "cloak",
            "text": "Admire the cloak.",
            "result": "\"Fine pin. Gaulish work?\" He grins, pleased. \"From the road-house at the ford. Kallisto has a cousin in the hills.\" He talks the way happy men talk. \"You want to know about the granary? Ask why the clerk Hipponax drinks at Kallisto's with men whose cloaks are better than mine.\"",
            "next": "S4-k"
          },
          {
            "id": "straight",
            "text": "Ask him straight.",
            "result": "\"Did any of our wheat not reach the city?\" He swears by every god in the city and two from the hills, and you learn nothing, except that he did not once look you in the eye.",
            "next": "S4-k"
          },
          {
            "id": "wagon",
            "text": "Search the wagon.",
            "result": "Under the driver's bench, folded small, three empty sacks with your estate's mark, and in one of them a wine token from the road-house at the ford. Drakon is behind you before you straighten. \"One sack a trip. For the mules' feed and a cup at Kallisto's. One sack. Never a tenth, I swear it on my freedom.\" You believe him about the tenth. One sack a wagon would not make three wagons a tenth short.",
            "next": "S4-k"
          }
        ]
      },
      {
        "type": "scene",
        "id": "S3-x",
        "body": {
          "eyebrow": "Drakon",
          "paragraphs": [
            "Drakon drives your wagons to the city and back. He was a slave until your father freed him. He is good with mules and bad with money, and tonight he has a new cloak with a Gaulish pin."
          ]
        },
        "image": "/stories/story-tenth-03-drakon.webp",
        "choices": [
          {
            "id": "cloak",
            "text": "Admire the cloak.",
            "result": "\"Fine pin. Gaulish work?\" He grins, pleased. \"From the road-house at the ford. Kallisto has a cousin in the hills.\" He talks the way happy men talk. \"You want to know about the granary? Ask why the clerk Hipponax drinks at Kallisto's with men whose cloaks are better than mine.\"",
            "next": "S4-x"
          },
          {
            "id": "straight",
            "text": "Ask him straight.",
            "result": "\"Did any of our wheat not reach the city?\" He swears by every god in the city and two from the hills, and you learn nothing, except that he did not once look you in the eye.",
            "next": "S4-x"
          },
          {
            "id": "wagon",
            "text": "Search the wagon.",
            "result": "Under the driver's bench, folded small, three empty sacks with your estate's mark, and in one of them a wine token from the road-house at the ford. Drakon is behind you before you straighten. \"One sack a trip. For the mules' feed and a cup at Kallisto's. One sack. Never a tenth, I swear it on my freedom.\" You believe him about the tenth. One sack a wagon would not make three wagons a tenth short.",
            "next": "S4-x"
          }
        ]
      },
      {
        "type": "scene",
        "id": "S4-k",
        "body": {
          "eyebrow": "Kallisto",
          "paragraphs": [
            "You ride to the road-house at the ford by lamplight. Kallisto keeps it: wine, fodder, beds for carters, and ears for everything said over the wine. She is scrubbing the last cups when you come in."
          ]
        },
        "image": "/stories/story-tenth-04-kallisto.webp",
        "choices": [
          {
            "id": "standing",
            "text": "Ask as a landowner of standing asks.",
            "requires": {
              "composure": 50
            },
            "result": "She knows your name, and what it will be worth tomorrow. \"The grain clerk, Hipponax. Three nights ago, at that table, with a steward in a good cloak who paid for everything. The clerk was drunk enough to be funny. He said the city's measure had grown a belly, and the steward told him to keep his mouth shut and his belly full.\"",
            "next": "S5-k",
            "otherwise": {
              "result": "She knows your name, and what the agora says it is worth tonight. \"I keep a road-house, not a court,\" she says, and goes on scrubbing. At the door she relents a little. \"Ask the grain clerk where he drinks.\"",
              "next": "S5-k"
            }
          },
          {
            "id": "coin",
            "text": "A coin on the counter.",
            "requires": {
              "drachmae": 5
            },
            "result": "She makes the coin disappear. \"Hipponax, the grain clerk. Here, three nights ago, with a steward who paid for the wine. The clerk said the city's measure had grown a belly. The steward did not laugh.\"",
            "next": "S5-k",
            "rewards": [
              {
                "type": "change_drachmae",
                "amount": -5
              }
            ]
          },
          {
            "id": "cup",
            "text": "Buy a cup and wait.",
            "result": "You buy a cup of her thin red and sit where the carters sit. She talks about the weather, the ford, the price of fodder. When you stand to go she says, not looking up, \"Your carter drinks here. He is not the one you want.\" It is all you will get.",
            "next": "S5-k"
          }
        ]
      },
      {
        "type": "scene",
        "id": "S4-x",
        "body": {
          "eyebrow": "Kallisto",
          "paragraphs": [
            "You ride to the road-house at the ford by lamplight. Kallisto keeps it: wine, fodder, beds for carters, and ears for everything said over the wine. She is scrubbing the last cups when you come in."
          ]
        },
        "image": "/stories/story-tenth-04-kallisto.webp",
        "choices": [
          {
            "id": "standing",
            "text": "Ask as a landowner of standing asks.",
            "requires": {
              "composure": 50
            },
            "result": "She knows your name, and what it will be worth tomorrow. \"The grain clerk, Hipponax. Three nights ago, at that table, with a steward in a good cloak who paid for everything. The clerk was drunk enough to be funny. He said the city's measure had grown a belly, and the steward told him to keep his mouth shut and his belly full.\"",
            "next": "S5-x",
            "otherwise": {
              "result": "She knows your name, and what the agora says it is worth tonight. \"I keep a road-house, not a court,\" she says, and goes on scrubbing. At the door she relents a little. \"Ask the grain clerk where he drinks.\"",
              "next": "S5-x"
            }
          },
          {
            "id": "coin",
            "text": "A coin on the counter.",
            "requires": {
              "drachmae": 5
            },
            "result": "She makes the coin disappear. \"Hipponax, the grain clerk. Here, three nights ago, with a steward who paid for the wine. The clerk said the city's measure had grown a belly. The steward did not laugh.\"",
            "next": "S5-x",
            "rewards": [
              {
                "type": "change_drachmae",
                "amount": -5
              }
            ]
          },
          {
            "id": "cup",
            "text": "Buy a cup and wait.",
            "result": "You buy a cup of her thin red and sit where the carters sit. She talks about the weather, the ford, the price of fodder. When you stand to go she says, not looking up, \"Your carter drinks here. He is not the one you want.\" It is all you will get.",
            "next": "S5-x"
          }
        ]
      },
      {
        "type": "scene",
        "id": "S5-k",
        "body": {
          "eyebrow": "Hipponax",
          "paragraphs": [
            "You find Hipponax at his door in the potters' quarter an hour before dawn, the granary keys on his belt. He is the wardens' clerk, the man who fills the city's measure. He is not surprised to see you. That is the first thing wrong."
          ]
        },
        "image": "/stories/story-tenth-05-hipponax.webp",
        "choices": [
          {
            "id": "threaten",
            "text": "Threaten him.",
            "requires": {
              "composure": 50
            },
            "result": "You keep your voice low and tell him what the Council does to a clerk who cheats the city's bread, and how few days it takes. He goes grey. \"The measure was beaten out. Not by me. I only filled it. A tenth over, every time, and the tenth went out the back door to a man who paid me for it.\" He will not say whose man. Not yet.",
            "next": "S6-k-p",
            "otherwise": {
              "result": "You mean to frighten him and your voice rises instead. He hears it and steadies. \"The city's measure is the city's measure,\" he says, and closes the door.",
              "next": "S6-k-w"
            }
          },
          {
            "id": "buy",
            "text": "Buy him.",
            "requires": {
              "drachmae": 10
            },
            "result": "The coins go into his sleeve. \"The measure was beaten out at the belly. A tenth over. The tenth went out the back of the granary before the count was sealed.\" He looks past you at the street. \"I will be at the measuring.\"",
            "next": "S6-k-p",
            "rewards": [
              {
                "type": "change_drachmae",
                "amount": -10
              }
            ]
          },
          {
            "id": "warn",
            "text": "Warn him you will be watching.",
            "result": "He bows and says he looks forward to it. You have met clerks before.",
            "next": "S6-k-w"
          }
        ]
      },
      {
        "type": "scene",
        "id": "S5-x",
        "body": {
          "eyebrow": "Hipponax",
          "paragraphs": [
            "You find Hipponax at his door in the potters' quarter an hour before dawn, the granary keys on his belt. He is the wardens' clerk, the man who fills the city's measure. He is not surprised to see you. That is the first thing wrong."
          ]
        },
        "image": "/stories/story-tenth-05-hipponax.webp",
        "choices": [
          {
            "id": "threaten",
            "text": "Threaten him.",
            "requires": {
              "composure": 50
            },
            "result": "You keep your voice low and tell him what the Council does to a clerk who cheats the city's bread, and how few days it takes. He goes grey. \"The measure was beaten out. Not by me. I only filled it. A tenth over, every time, and the tenth went out the back door to a man who paid me for it.\" He will not say whose man. Not yet.",
            "next": "S6-x-p",
            "otherwise": {
              "result": "You mean to frighten him and your voice rises instead. He hears it and steadies. \"The city's measure is the city's measure,\" he says, and closes the door.",
              "next": "S6-x-w"
            }
          },
          {
            "id": "buy",
            "text": "Buy him.",
            "requires": {
              "drachmae": 10
            },
            "result": "The coins go into his sleeve. \"The measure was beaten out at the belly. A tenth over. The tenth went out the back of the granary before the count was sealed.\" He looks past you at the street. \"I will be at the measuring.\"",
            "next": "S6-x-p",
            "rewards": [
              {
                "type": "change_drachmae",
                "amount": -10
              }
            ]
          },
          {
            "id": "warn",
            "text": "Warn him you will be watching.",
            "result": "He bows and says he looks forward to it. You have met clerks before.",
            "next": "S6-x-w"
          }
        ]
      },
      {
        "type": "scene",
        "id": "S6-k-p",
        "body": {
          "eyebrow": "The measuring",
          "paragraphs": [
            "Dawn at the granary. Your next wagons stand in the yard. The chief warden is there with his scribe, and a small crowd that has heard there might be a scandal, and the city's bronze measure on its block, the one that has grown a belly."
          ]
        },
        "image": "/stories/story-tenth-06-measuring.webp",
        "choices": [
          {
            "id": "temple",
            "text": "Call for the Temple's standard.",
            "requires": {
              "composure": 50
            },
            "result": "You ask, loudly enough for the crowd, that the standard measure be brought from the Temple of Artemis, as the law allows. The chief warden cannot refuse a name that loud. The standard comes under a cloth, is filled with water and poured into the city's measure, and the city's measure takes it all and a tenth more. The crowd sees it before the warden does.",
            "next": "S7-k",
            "otherwise": {
              "result": "You ask for the Temple's standard, and the chief warden asks who you are to doubt the city's bronze. The crowd laughs with him. Your wagons are measured on the city's measure and come up a tenth short, and the count stands.",
              "next": "S8-k-unproven"
            }
          },
          {
            "id": "pour",
            "text": "Pour Philinos's measure.",
            "result": "Philinos steps forward with the estate's own bronze measure, stamped by the wardens in your father's time. He fills it with wheat and pours it into the city's measure, three times, in front of everyone, and three times the city's measure is not full. He does not say a word. He does not need to.",
            "next": "S7-k"
          },
          {
            "id": "clerk",
            "text": "Let Hipponax speak.",
            "result": "Hipponax is more afraid of you this morning than of anyone else. When the chief warden hands him the measure he holds it out in both hands, turns it so the crowd can see the new bronze at the belly, and says what it is.",
            "next": "S7-k"
          }
        ]
      },
      {
        "type": "scene",
        "id": "S6-k-w",
        "body": {
          "eyebrow": "The measuring",
          "paragraphs": [
            "Dawn at the granary. Your next wagons stand in the yard. The chief warden is there with his scribe, and a small crowd that has heard there might be a scandal, and the city's bronze measure on its block, the one that has grown a belly."
          ]
        },
        "image": "/stories/story-tenth-06-measuring.webp",
        "choices": [
          {
            "id": "temple",
            "text": "Call for the Temple's standard.",
            "requires": {
              "composure": 50
            },
            "result": "You ask, loudly enough for the crowd, that the standard measure be brought from the Temple of Artemis, as the law allows. The chief warden cannot refuse a name that loud. The standard comes under a cloth, is filled with water and poured into the city's measure, and the city's measure takes it all and a tenth more. The crowd sees it before the warden does.",
            "next": "S7-k",
            "otherwise": {
              "result": "You ask for the Temple's standard, and the chief warden asks who you are to doubt the city's bronze. The crowd laughs with him. Your wagons are measured on the city's measure and come up a tenth short, and the count stands.",
              "next": "S8-k-unproven"
            }
          },
          {
            "id": "pour",
            "text": "Pour Philinos's measure.",
            "result": "Philinos steps forward with the estate's own bronze measure, stamped by the wardens in your father's time. He fills it with wheat and pours it into the city's measure, three times, in front of everyone, and three times the city's measure is not full. He does not say a word. He does not need to.",
            "next": "S7-k"
          },
          {
            "id": "clerk",
            "text": "Let Hipponax speak.",
            "result": "Hipponax is not there. A different clerk brings a different measure, true to the Temple's standard, and this morning's wagons weigh full. Yesterday's count stands, and there is no one left to say why.",
            "next": "S8-k-unproven"
          }
        ]
      },
      {
        "type": "scene",
        "id": "S6-x-p",
        "body": {
          "eyebrow": "The measuring",
          "paragraphs": [
            "Dawn at the granary. Your next wagons stand in the yard. The chief warden is there with his scribe, and a small crowd that has heard there might be a scandal, and the city's bronze measure on its block, the one that has grown a belly."
          ]
        },
        "image": "/stories/story-tenth-06-measuring.webp",
        "choices": [
          {
            "id": "temple",
            "text": "Call for the Temple's standard.",
            "requires": {
              "composure": 50
            },
            "result": "You ask, loudly enough for the crowd, that the standard measure be brought from the Temple of Artemis, as the law allows. The chief warden cannot refuse a name that loud. The standard comes under a cloth, is filled with water and poured into the city's measure, and the city's measure takes it all and a tenth more. The crowd sees it before the warden does.",
            "next": "S7-x",
            "otherwise": {
              "result": "You ask for the Temple's standard, and the chief warden asks who you are to doubt the city's bronze. The crowd laughs with him. Your wagons are measured on the city's measure and come up a tenth short, and the count stands.",
              "next": "S8-x-unproven"
            }
          },
          {
            "id": "pour",
            "text": "Pour Philinos's measure.",
            "requires": {
              "composure": 50
            },
            "result": "You carry the estate's bronze measure out yourself, because there is no one else, and fill it, and pour it three times, steady, into the city's measure, and three times the city's measure is not full.",
            "next": "S7-x",
            "otherwise": {
              "result": "You carry the estate's measure out yourself, because there is no one else. Your hands are not steady. Wheat goes across the flagstones, the crowd laughs, and the chief warden has your wagons measured the city's way. A tenth short. The count stands.",
              "next": "S8-x-unproven"
            }
          },
          {
            "id": "clerk",
            "text": "Let Hipponax speak.",
            "result": "Hipponax is more afraid of you this morning than of anyone else. When the chief warden hands him the measure he holds it out in both hands, turns it so the crowd can see the new bronze at the belly, and says what it is.",
            "next": "S7-x"
          }
        ]
      },
      {
        "type": "scene",
        "id": "S6-x-w",
        "body": {
          "eyebrow": "The measuring",
          "paragraphs": [
            "Dawn at the granary. Your next wagons stand in the yard. The chief warden is there with his scribe, and a small crowd that has heard there might be a scandal, and the city's bronze measure on its block, the one that has grown a belly."
          ]
        },
        "image": "/stories/story-tenth-06-measuring.webp",
        "choices": [
          {
            "id": "temple",
            "text": "Call for the Temple's standard.",
            "requires": {
              "composure": 50
            },
            "result": "You ask, loudly enough for the crowd, that the standard measure be brought from the Temple of Artemis, as the law allows. The chief warden cannot refuse a name that loud. The standard comes under a cloth, is filled with water and poured into the city's measure, and the city's measure takes it all and a tenth more. The crowd sees it before the warden does.",
            "next": "S7-x",
            "otherwise": {
              "result": "You ask for the Temple's standard, and the chief warden asks who you are to doubt the city's bronze. The crowd laughs with him. Your wagons are measured on the city's measure and come up a tenth short, and the count stands.",
              "next": "S8-x-unproven"
            }
          },
          {
            "id": "pour",
            "text": "Pour Philinos's measure.",
            "requires": {
              "composure": 50
            },
            "result": "You carry the estate's bronze measure out yourself, because there is no one else, and fill it, and pour it three times, steady, into the city's measure, and three times the city's measure is not full.",
            "next": "S7-x",
            "otherwise": {
              "result": "You carry the estate's measure out yourself, because there is no one else. Your hands are not steady. Wheat goes across the flagstones, the crowd laughs, and the chief warden has your wagons measured the city's way. A tenth short. The count stands.",
              "next": "S8-x-unproven"
            }
          },
          {
            "id": "clerk",
            "text": "Let Hipponax speak.",
            "result": "Hipponax is not there. A different clerk brings a different measure, true to the Temple's standard, and this morning's wagons weigh full. Yesterday's count stands, and there is no one left to say why.",
            "next": "S8-x-unproven"
          }
        ]
      },
      {
        "type": "scene",
        "id": "S7-k",
        "body": {
          "eyebrow": "The clerk",
          "paragraphs": [
            "The chief warden has the measure. Hipponax is on his knees in the granary doorway, and the crowd is waiting to see what you will do with him."
          ]
        },
        "image": "/stories/story-tenth-07-clerk.webp",
        "choices": [
          {
            "id": "agora",
            "text": "Before the whole agora.",
            "result": "You have the chief warden read the count again, true this time, loud enough for the fish stalls. The city pays your short tenth from the granary chest, and Hipponax is taken before the Council. He names no one, and by noon it does not matter. The agora has a new story, and your name is in it the right way round.",
            "next": "S8-k-public",
            "rewards": [
              {
                "type": "change_drachmae",
                "amount": 55
              },
              {
                "type": "change_stat",
                "stat": "prestige",
                "amount": 2
              }
            ]
          },
          {
            "id": "name",
            "text": "His silence for a name.",
            "result": "You ask the warden for a moment with the clerk behind the granary. \"Who paid for the belly?\" He weighs the Council against you and chooses you. \"The steward of House {house}. His master wants your contract. The tenth went to their barns.\" The wardens settle your count quietly, and you walk out with your silver and something worth more.",
            "next": "S8-k-name",
            "rewards": [
              {
                "type": "change_drachmae",
                "amount": 45
              },
              {
                "type": "change_stat",
                "stat": "intelligence",
                "amount": 2
              }
            ]
          },
          {
            "id": "quiet",
            "text": "The wardens' silver, and quiet.",
            "result": "The chief warden takes you aside. The city would rather not have its measure talked about. He pays your short tenth and a tenth again for your silence, and Hipponax is sent to count amphorae in Olbia. The agora keeps its old story about you, because no one tells it a better one.",
            "next": "S8-k-quiet",
            "rewards": [
              {
                "type": "change_drachmae",
                "amount": 90
              },
              {
                "type": "change_stat",
                "stat": "prestige",
                "amount": -1
              }
            ]
          }
        ]
      },
      {
        "type": "scene",
        "id": "S7-x",
        "body": {
          "eyebrow": "The clerk",
          "paragraphs": [
            "The chief warden has the measure. Hipponax is on his knees in the granary doorway, and the crowd is waiting to see what you will do with him."
          ]
        },
        "image": "/stories/story-tenth-07-clerk.webp",
        "choices": [
          {
            "id": "agora",
            "text": "Before the whole agora.",
            "result": "You have the chief warden read the count again, true this time, loud enough for the fish stalls. The city pays your short tenth from the granary chest, and Hipponax is taken before the Council. He names no one, and by noon it does not matter. The agora has a new story, and your name is in it the right way round.",
            "next": "S8-x-public",
            "rewards": [
              {
                "type": "change_drachmae",
                "amount": 55
              },
              {
                "type": "change_stat",
                "stat": "prestige",
                "amount": 2
              }
            ]
          },
          {
            "id": "name",
            "text": "His silence for a name.",
            "result": "You ask the warden for a moment with the clerk behind the granary. \"Who paid for the belly?\" He weighs the Council against you and chooses you. \"The steward of House {house}. His master wants your contract. The tenth went to their barns.\" The wardens settle your count quietly, and you walk out with your silver and something worth more.",
            "next": "S8-x-name",
            "rewards": [
              {
                "type": "change_drachmae",
                "amount": 45
              },
              {
                "type": "change_stat",
                "stat": "intelligence",
                "amount": 2
              }
            ]
          },
          {
            "id": "quiet",
            "text": "The wardens' silver, and quiet.",
            "result": "The chief warden takes you aside. The city would rather not have its measure talked about. He pays your short tenth and a tenth again for your silence, and Hipponax is sent to count amphorae in Olbia. The agora keeps its old story about you, because no one tells it a better one.",
            "next": "S8-x-quiet",
            "rewards": [
              {
                "type": "change_drachmae",
                "amount": 90
              },
              {
                "type": "change_stat",
                "stat": "prestige",
                "amount": -1
              }
            ]
          }
        ]
      },
      {
        "type": "scene",
        "id": "S8-k-public",
        "body": {
          "eyebrow": "Drakon",
          "paragraphs": [
            "The morning is well up by the time you are home. Whatever else you found, the road-house or the wagon bench says the same thing: Drakon sold one sack a trip for fodder and wine. He is waiting in the yard with his new cloak folded over his arm."
          ]
        },
        "image": "/stories/story-tenth-08-stone.webp",
        "choices": [
          {
            "id": "keep",
            "text": "Keep him, docked.",
            "result": "\"One sack a trip, at the granary's price, out of your wages until it is paid.\" He agrees before you finish. He keeps the cloak.",
            "next": "S9-k-public",
            "rewards": [
              {
                "type": "change_drachmae",
                "amount": 15
              }
            ]
          },
          {
            "id": "send",
            "text": "Send him away.",
            "result": "You give him his wages to the day and the mule he likes. He goes down the road toward the ford without looking back. You will need a new carter by the next harvest.",
            "next": "S9-k-public"
          },
          {
            "id": "oath",
            "text": "An oath at the boundary stone.",
            "result": "You walk him to the old stone at the edge of the upper field, where your father swore to Zeus of the Boundaries, and he swears there, his hand on the stone, never to take from this land what he could have asked for. It is an old custom. It will hold him better than wages.",
            "next": "S9-k-public",
            "rewards": [
              {
                "type": "change_stat",
                "stat": "devotion",
                "amount": 1
              }
            ]
          }
        ]
      },
      {
        "type": "scene",
        "id": "S8-k-name",
        "body": {
          "eyebrow": "Drakon",
          "paragraphs": [
            "The morning is well up by the time you are home. Whatever else you found, the road-house or the wagon bench says the same thing: Drakon sold one sack a trip for fodder and wine. He is waiting in the yard with his new cloak folded over his arm."
          ]
        },
        "image": "/stories/story-tenth-08-stone.webp",
        "choices": [
          {
            "id": "keep",
            "text": "Keep him, docked.",
            "result": "\"One sack a trip, at the granary's price, out of your wages until it is paid.\" He agrees before you finish. He keeps the cloak.",
            "next": "S9-k-name",
            "rewards": [
              {
                "type": "change_drachmae",
                "amount": 15
              }
            ]
          },
          {
            "id": "send",
            "text": "Send him away.",
            "result": "You give him his wages to the day and the mule he likes. He goes down the road toward the ford without looking back. You will need a new carter by the next harvest.",
            "next": "S9-k-name"
          },
          {
            "id": "oath",
            "text": "An oath at the boundary stone.",
            "result": "You walk him to the old stone at the edge of the upper field, where your father swore to Zeus of the Boundaries, and he swears there, his hand on the stone, never to take from this land what he could have asked for. It is an old custom. It will hold him better than wages.",
            "next": "S9-k-name",
            "rewards": [
              {
                "type": "change_stat",
                "stat": "devotion",
                "amount": 1
              }
            ]
          }
        ]
      },
      {
        "type": "scene",
        "id": "S8-k-quiet",
        "body": {
          "eyebrow": "Drakon",
          "paragraphs": [
            "The morning is well up by the time you are home. Whatever else you found, the road-house or the wagon bench says the same thing: Drakon sold one sack a trip for fodder and wine. He is waiting in the yard with his new cloak folded over his arm."
          ]
        },
        "image": "/stories/story-tenth-08-stone.webp",
        "choices": [
          {
            "id": "keep",
            "text": "Keep him, docked.",
            "result": "\"One sack a trip, at the granary's price, out of your wages until it is paid.\" He agrees before you finish. He keeps the cloak.",
            "next": "S9-k-quiet",
            "rewards": [
              {
                "type": "change_drachmae",
                "amount": 15
              }
            ]
          },
          {
            "id": "send",
            "text": "Send him away.",
            "result": "You give him his wages to the day and the mule he likes. He goes down the road toward the ford without looking back. You will need a new carter by the next harvest.",
            "next": "S9-k-quiet"
          },
          {
            "id": "oath",
            "text": "An oath at the boundary stone.",
            "result": "You walk him to the old stone at the edge of the upper field, where your father swore to Zeus of the Boundaries, and he swears there, his hand on the stone, never to take from this land what he could have asked for. It is an old custom. It will hold him better than wages.",
            "next": "S9-k-quiet",
            "rewards": [
              {
                "type": "change_stat",
                "stat": "devotion",
                "amount": 1
              }
            ]
          }
        ]
      },
      {
        "type": "scene",
        "id": "S8-k-unproven",
        "body": {
          "eyebrow": "Drakon",
          "paragraphs": [
            "The morning is well up by the time you are home. Whatever else you found, the road-house or the wagon bench says the same thing: Drakon sold one sack a trip for fodder and wine. He is waiting in the yard with his new cloak folded over his arm."
          ]
        },
        "image": "/stories/story-tenth-08-stone.webp",
        "choices": [
          {
            "id": "keep",
            "text": "Keep him, docked.",
            "result": "\"One sack a trip, at the granary's price, out of your wages until it is paid.\" He agrees before you finish. He keeps the cloak.",
            "next": "S9-k-unproven",
            "rewards": [
              {
                "type": "change_drachmae",
                "amount": 15
              }
            ]
          },
          {
            "id": "send",
            "text": "Send him away.",
            "result": "You give him his wages to the day and the mule he likes. He goes down the road toward the ford without looking back. You will need a new carter by the next harvest.",
            "next": "S9-k-unproven"
          },
          {
            "id": "oath",
            "text": "An oath at the boundary stone.",
            "result": "You walk him to the old stone at the edge of the upper field, where your father swore to Zeus of the Boundaries, and he swears there, his hand on the stone, never to take from this land what he could have asked for. It is an old custom. It will hold him better than wages.",
            "next": "S9-k-unproven",
            "rewards": [
              {
                "type": "change_stat",
                "stat": "devotion",
                "amount": 1
              }
            ]
          }
        ]
      },
      {
        "type": "scene",
        "id": "S8-x-public",
        "body": {
          "eyebrow": "Drakon",
          "paragraphs": [
            "The morning is well up by the time you are home. Whatever else you found, the road-house or the wagon bench says the same thing: Drakon sold one sack a trip for fodder and wine. He is waiting in the yard with his new cloak folded over his arm."
          ]
        },
        "image": "/stories/story-tenth-08-stone.webp",
        "choices": [
          {
            "id": "keep",
            "text": "Keep him, docked.",
            "result": "\"One sack a trip, at the granary's price, out of your wages until it is paid.\" He agrees before you finish. He keeps the cloak.",
            "next": "S9-x-public",
            "rewards": [
              {
                "type": "change_drachmae",
                "amount": 15
              }
            ]
          },
          {
            "id": "send",
            "text": "Send him away.",
            "result": "You give him his wages to the day and the mule he likes. He goes down the road toward the ford without looking back. You will need a new carter by the next harvest.",
            "next": "S9-x-public"
          },
          {
            "id": "oath",
            "text": "An oath at the boundary stone.",
            "result": "You walk him to the old stone at the edge of the upper field, where your father swore to Zeus of the Boundaries, and he swears there, his hand on the stone, never to take from this land what he could have asked for. It is an old custom. It will hold him better than wages.",
            "next": "S9-x-public",
            "rewards": [
              {
                "type": "change_stat",
                "stat": "devotion",
                "amount": 1
              }
            ]
          }
        ]
      },
      {
        "type": "scene",
        "id": "S8-x-name",
        "body": {
          "eyebrow": "Drakon",
          "paragraphs": [
            "The morning is well up by the time you are home. Whatever else you found, the road-house or the wagon bench says the same thing: Drakon sold one sack a trip for fodder and wine. He is waiting in the yard with his new cloak folded over his arm."
          ]
        },
        "image": "/stories/story-tenth-08-stone.webp",
        "choices": [
          {
            "id": "keep",
            "text": "Keep him, docked.",
            "result": "\"One sack a trip, at the granary's price, out of your wages until it is paid.\" He agrees before you finish. He keeps the cloak.",
            "next": "S9-x-name",
            "rewards": [
              {
                "type": "change_drachmae",
                "amount": 15
              }
            ]
          },
          {
            "id": "send",
            "text": "Send him away.",
            "result": "You give him his wages to the day and the mule he likes. He goes down the road toward the ford without looking back. You will need a new carter by the next harvest.",
            "next": "S9-x-name"
          },
          {
            "id": "oath",
            "text": "An oath at the boundary stone.",
            "result": "You walk him to the old stone at the edge of the upper field, where your father swore to Zeus of the Boundaries, and he swears there, his hand on the stone, never to take from this land what he could have asked for. It is an old custom. It will hold him better than wages.",
            "next": "S9-x-name",
            "rewards": [
              {
                "type": "change_stat",
                "stat": "devotion",
                "amount": 1
              }
            ]
          }
        ]
      },
      {
        "type": "scene",
        "id": "S8-x-quiet",
        "body": {
          "eyebrow": "Drakon",
          "paragraphs": [
            "The morning is well up by the time you are home. Whatever else you found, the road-house or the wagon bench says the same thing: Drakon sold one sack a trip for fodder and wine. He is waiting in the yard with his new cloak folded over his arm."
          ]
        },
        "image": "/stories/story-tenth-08-stone.webp",
        "choices": [
          {
            "id": "keep",
            "text": "Keep him, docked.",
            "result": "\"One sack a trip, at the granary's price, out of your wages until it is paid.\" He agrees before you finish. He keeps the cloak.",
            "next": "S9-x-quiet",
            "rewards": [
              {
                "type": "change_drachmae",
                "amount": 15
              }
            ]
          },
          {
            "id": "send",
            "text": "Send him away.",
            "result": "You give him his wages to the day and the mule he likes. He goes down the road toward the ford without looking back. You will need a new carter by the next harvest.",
            "next": "S9-x-quiet"
          },
          {
            "id": "oath",
            "text": "An oath at the boundary stone.",
            "result": "You walk him to the old stone at the edge of the upper field, where your father swore to Zeus of the Boundaries, and he swears there, his hand on the stone, never to take from this land what he could have asked for. It is an old custom. It will hold him better than wages.",
            "next": "S9-x-quiet",
            "rewards": [
              {
                "type": "change_stat",
                "stat": "devotion",
                "amount": 1
              }
            ]
          }
        ]
      },
      {
        "type": "scene",
        "id": "S8-x-unproven",
        "body": {
          "eyebrow": "Drakon",
          "paragraphs": [
            "The morning is well up by the time you are home. Whatever else you found, the road-house or the wagon bench says the same thing: Drakon sold one sack a trip for fodder and wine. He is waiting in the yard with his new cloak folded over his arm."
          ]
        },
        "image": "/stories/story-tenth-08-stone.webp",
        "choices": [
          {
            "id": "keep",
            "text": "Keep him, docked.",
            "result": "\"One sack a trip, at the granary's price, out of your wages until it is paid.\" He agrees before you finish. He keeps the cloak.",
            "next": "S9-x-unproven",
            "rewards": [
              {
                "type": "change_drachmae",
                "amount": 15
              }
            ]
          },
          {
            "id": "send",
            "text": "Send him away.",
            "result": "You give him his wages to the day and the mule he likes. He goes down the road toward the ford without looking back. You will need a new carter by the next harvest.",
            "next": "S9-x-unproven"
          },
          {
            "id": "oath",
            "text": "An oath at the boundary stone.",
            "result": "You walk him to the old stone at the edge of the upper field, where your father swore to Zeus of the Boundaries, and he swears there, his hand on the stone, never to take from this land what he could have asked for. It is an old custom. It will hold him better than wages.",
            "next": "S9-x-unproven",
            "rewards": [
              {
                "type": "change_stat",
                "stat": "devotion",
                "amount": 1
              }
            ]
          }
        ]
      },
      {
        "type": "scene",
        "id": "S9-k-public",
        "body": {
          "eyebrow": "Philinos and the contract",
          "paragraphs": [
            "Philinos is in the barn with his tablets, counting the empty sacks as if it were any other morning. The granary contract runs out at the next harvest, and he wants to know what to write."
          ]
        },
        "image": "/stories/story-tenth-09-contract.webp",
        "choices": [
          {
            "id": "renew",
            "text": "Renew the contract.",
            "result": "\"The city's bread,\" he says, and writes it. \"Next time I watch the measuring.\" The wardens pay the first instalment on the new contract before the ink is dry.",
            "next": "END-public",
            "rewards": [
              {
                "type": "change_drachmae",
                "amount": 10
              },
              {
                "type": "change_stat",
                "stat": "prestige",
                "amount": 1
              }
            ]
          },
          {
            "id": "emporion",
            "text": "Sell the next harvest to the Emporion ships.",
            "result": "\"They pay in silver and they bring their own measure,\" he says. \"Good.\" He writes it.",
            "next": "END-public",
            "rewards": [
              {
                "type": "change_drachmae",
                "amount": 35
              }
            ]
          }
        ]
      },
      {
        "type": "scene",
        "id": "S9-k-name",
        "body": {
          "eyebrow": "Philinos and the contract",
          "paragraphs": [
            "Philinos is in the barn with his tablets, counting the empty sacks as if it were any other morning. The granary contract runs out at the next harvest, and he wants to know what to write."
          ]
        },
        "image": "/stories/story-tenth-09-contract.webp",
        "choices": [
          {
            "id": "renew",
            "text": "Renew the contract.",
            "result": "\"The city's bread,\" he says, and writes it. \"Next time I watch the measuring.\" The wardens pay the first instalment on the new contract before the ink is dry.",
            "next": "END-name",
            "rewards": [
              {
                "type": "change_drachmae",
                "amount": 10
              },
              {
                "type": "change_stat",
                "stat": "prestige",
                "amount": 1
              }
            ]
          },
          {
            "id": "emporion",
            "text": "Sell the next harvest to the Emporion ships.",
            "result": "\"They pay in silver and they bring their own measure,\" he says. \"Good.\" He writes it.",
            "next": "END-name",
            "rewards": [
              {
                "type": "change_drachmae",
                "amount": 35
              }
            ]
          }
        ]
      },
      {
        "type": "scene",
        "id": "S9-k-quiet",
        "body": {
          "eyebrow": "Philinos and the contract",
          "paragraphs": [
            "Philinos is in the barn with his tablets, counting the empty sacks as if it were any other morning. The granary contract runs out at the next harvest, and he wants to know what to write."
          ]
        },
        "image": "/stories/story-tenth-09-contract.webp",
        "choices": [
          {
            "id": "renew",
            "text": "Renew the contract.",
            "result": "\"The city's bread,\" he says, and writes it. \"Next time I watch the measuring.\" The wardens pay the first instalment on the new contract before the ink is dry.",
            "next": "END-quiet",
            "rewards": [
              {
                "type": "change_drachmae",
                "amount": 10
              },
              {
                "type": "change_stat",
                "stat": "prestige",
                "amount": 1
              }
            ]
          },
          {
            "id": "emporion",
            "text": "Sell the next harvest to the Emporion ships.",
            "result": "\"They pay in silver and they bring their own measure,\" he says. \"Good.\" He writes it.",
            "next": "END-quiet",
            "rewards": [
              {
                "type": "change_drachmae",
                "amount": 35
              }
            ]
          }
        ]
      },
      {
        "type": "scene",
        "id": "S9-k-unproven",
        "body": {
          "eyebrow": "Philinos and the contract",
          "paragraphs": [
            "Philinos is in the barn with his tablets, counting the empty sacks as if it were any other morning. The granary contract runs out at the next harvest, and he wants to know what to write."
          ]
        },
        "image": "/stories/story-tenth-09-contract.webp",
        "choices": [
          {
            "id": "renew",
            "text": "Renew the contract.",
            "result": "\"The city's bread,\" he says, and writes it. \"Next time I watch the measuring.\" The wardens pay the first instalment on the new contract before the ink is dry.",
            "next": "END-unproven",
            "rewards": [
              {
                "type": "change_drachmae",
                "amount": 10
              },
              {
                "type": "change_stat",
                "stat": "prestige",
                "amount": 1
              }
            ]
          },
          {
            "id": "emporion",
            "text": "Sell the next harvest to the Emporion ships.",
            "result": "\"They pay in silver and they bring their own measure,\" he says. \"Good.\" He writes it.",
            "next": "END-unproven",
            "rewards": [
              {
                "type": "change_drachmae",
                "amount": 35
              }
            ]
          }
        ]
      },
      {
        "type": "scene",
        "id": "S9-x-public",
        "body": {
          "eyebrow": "Philinos and the contract",
          "paragraphs": [
            "Philinos's hut is open. His tablets are on the step, and he is at the gate with a bundle over his shoulder."
          ]
        },
        "image": "/stories/story-tenth-09-contract.webp",
        "choices": [
          {
            "id": "let-go",
            "text": "Let him go.",
            "result": "He goes down the road with his bundle and does not look back at the fields he kept for thirty years. The new steward will count everything once.",
            "next": "END-public"
          },
          {
            "id": "stay",
            "text": "Ask him to stay.",
            "result": "You go down to the gate and say, in front of the hands, the word you said wrong last night. He puts the bundle down. He does not forgive you. He stays, and he counts.",
            "next": "END-public",
            "rewards": [
              {
                "type": "change_stat",
                "stat": "prestige",
                "amount": -1
              }
            ]
          }
        ]
      },
      {
        "type": "scene",
        "id": "S9-x-name",
        "body": {
          "eyebrow": "Philinos and the contract",
          "paragraphs": [
            "Philinos's hut is open. His tablets are on the step, and he is at the gate with a bundle over his shoulder."
          ]
        },
        "image": "/stories/story-tenth-09-contract.webp",
        "choices": [
          {
            "id": "let-go",
            "text": "Let him go.",
            "result": "He goes down the road with his bundle and does not look back at the fields he kept for thirty years. The new steward will count everything once.",
            "next": "END-name"
          },
          {
            "id": "stay",
            "text": "Ask him to stay.",
            "result": "You go down to the gate and say, in front of the hands, the word you said wrong last night. He puts the bundle down. He does not forgive you. He stays, and he counts.",
            "next": "END-name",
            "rewards": [
              {
                "type": "change_stat",
                "stat": "prestige",
                "amount": -1
              }
            ]
          }
        ]
      },
      {
        "type": "scene",
        "id": "S9-x-quiet",
        "body": {
          "eyebrow": "Philinos and the contract",
          "paragraphs": [
            "Philinos's hut is open. His tablets are on the step, and he is at the gate with a bundle over his shoulder."
          ]
        },
        "image": "/stories/story-tenth-09-contract.webp",
        "choices": [
          {
            "id": "let-go",
            "text": "Let him go.",
            "result": "He goes down the road with his bundle and does not look back at the fields he kept for thirty years. The new steward will count everything once.",
            "next": "END-quiet"
          },
          {
            "id": "stay",
            "text": "Ask him to stay.",
            "result": "You go down to the gate and say, in front of the hands, the word you said wrong last night. He puts the bundle down. He does not forgive you. He stays, and he counts.",
            "next": "END-quiet",
            "rewards": [
              {
                "type": "change_stat",
                "stat": "prestige",
                "amount": -1
              }
            ]
          }
        ]
      },
      {
        "type": "scene",
        "id": "S9-x-unproven",
        "body": {
          "eyebrow": "Philinos and the contract",
          "paragraphs": [
            "Philinos's hut is open. His tablets are on the step, and he is at the gate with a bundle over his shoulder."
          ]
        },
        "image": "/stories/story-tenth-09-contract.webp",
        "choices": [
          {
            "id": "let-go",
            "text": "Let him go.",
            "result": "He goes down the road with his bundle and does not look back at the fields he kept for thirty years. The new steward will count everything once.",
            "next": "END-unproven"
          },
          {
            "id": "stay",
            "text": "Ask him to stay.",
            "result": "You go down to the gate and say, in front of the hands, the word you said wrong last night. He puts the bundle down. He does not forgive you. He stays, and he counts.",
            "next": "END-unproven",
            "rewards": [
              {
                "type": "change_stat",
                "stat": "prestige",
                "amount": -1
              }
            ]
          }
        ]
      },
      {
        "type": "terminal",
        "id": "END-public",
        "body": {
          "paragraphs": [
            "The morning the city's measure was found to have a belly, and the whole agora heard it."
          ]
        },
        "chronicle": [
          "The morning the city's measure was found to have a belly, and the whole agora heard it."
        ],
        "rewards": []
      },
      {
        "type": "terminal",
        "id": "END-name",
        "body": {
          "paragraphs": [
            "The morning the city's measure was found to have a belly, and whose silver put it there.",
            "The steward of House {house} paid a clerk to cheat the city's grain measure."
          ]
        },
        "chronicle": [
          "The morning the city's measure was found to have a belly, and whose silver put it there.",
          "The steward of House {house} paid a clerk to cheat the city's grain measure."
        ],
        "rewards": []
      },
      {
        "type": "terminal",
        "id": "END-quiet",
        "body": {
          "paragraphs": [
            "The morning the city's measure was found to have a belly, and the wardens paid to keep it quiet."
          ]
        },
        "chronicle": [
          "The morning the city's measure was found to have a belly, and the wardens paid to keep it quiet."
        ],
        "rewards": []
      },
      {
        "type": "terminal",
        "id": "END-unproven",
        "body": {
          "paragraphs": [
            "The morning the granary counted your wheat a tenth short, and the count stood."
          ]
        },
        "chronicle": [
          "The morning the granary counted your wheat a tenth short, and the count stood."
        ],
        "rewards": [
          {
            "type": "change_drachmae",
            "amount": -20
          },
          {
            "type": "change_stat",
            "stat": "prestige",
            "amount": -2
          }
        ]
      }
    ]
  }
}
```

END OF PROMPT
