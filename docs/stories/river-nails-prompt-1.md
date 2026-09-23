# River Nails, prompt 1: a class-triggered story for the Shipbuilder

## What this builds

A third interactive story beside The Silver of Artemis and The House of Roses: River Nails, a one-sitting story offered to every Shipbuilder. The player builds a small fishing boat for old Glaukos against the tunny run; the freeman Segomaros is hurt at the shed and knows a faster way to build, iron nails clenched through plank and rib, the way the river men build up the Rhodanos. Nine steps after the opening, two or three choices each, five endings.

The Story Engine already has everything the script needs since The House of Roses: `requires` with `otherwise` fallbacks, locked and priced choices, `gain_good`, the class trigger with an opening date, and Chronicle lines on terminals. This prompt is content only: the story file, its eleven images, one registry line and tests, in one commit. No engine, client or stylesheet change. No migration.

Rulings (Argiris, 23 Sept 2026):

- The story is offered to every character of class `shipbuilder` once the world reaches Spring 298 BC (World 2: 2026-09-24 00:00 UTC, 03:00 Corfu). A Shipbuilder created after that is offered it at once. The offer is read lazily on dashboard load, so a deploy after the rollover still offers it to everyone.
- Gates as in The House of Roses: composure 50, prestige 10. Every stat check in this story has its fallback (the script's Fail line), so no choice is ever shown locked for a stat. Paid choices (5, 8, 10 and 15 drachmae) show their price and lock when the purse cannot cover them.
- The script's "Composure +1 / -1" is composure +5 / -5 (the scale the event cards and The House of Roses use). Prestige moves by 1, as scripted.
- The days in the story are story time only. Nothing is scheduled or timed.
- The engine stays flag-free. The three things the story remembers (Segomaros's trust, the day the boat goes in, what happened with Dexippos) are encoded as duplicated nodes; the scheme is below.
- Glaukos's share is 90 drachmae at nine days and 60 at ten, less 10 when Dexippos scared him (7B failed), then less a tenth of what is left when Segomaros's trust was under 3. It is paid as one net drachmae credit together with 2 naval supplies, on a short "Glaukos pays" beat after the launch choice, so the reward strip shows the silver with the text that explains it. The refused paths earn no share.
- Every ending writes its own Chronicle line from the script.
- The offer card in the Court panel shows the opening image, as the other two stories do.
- The images come from `/Users/macbook/Desktop/MoShip`.

## The node scheme

- Trust counts one for: S1 `ask`; S2 `shoulder` on either branch; S3 `bind` on its main branch and S3 `physician`; S4 `supper` on its main branch and S4 `wages`. Nodes: `S2-t0`, `S2-t1`; `S3-t0`, `S3-t1`, `S3-t2`; `S4-t01` (trust at most 1), `S4-t2`, `S4-t3` (3 or more); `S5-high` (trust 3 or more at the end of Step 4) and `S5-low`, which differ in their second paragraph.
- `S6-<high|low>-<dexippos|glaukos>`: the trust bucket and the Step 5 route (`quietly` leads through Step 7, `glaukos` skips it). `S6R` is the pegged way.
- `S7-<high|low>-<9|10>`: trust and days.
- `S8-` and `PAY-nails-<high|low>-<9|10>-<clean|docked|pitched>`, and `S8-` and `PAY-pegged-<12|late>`: fourteen launch scenes and fourteen pay beats, one per state.
- `S9-nails-<9|10>` and `S9-pegged-<12|late>`.
- Terminals: `END-river` (nails, nine days), `END-wreck` (nails, ten days), `END-sold`, `END-pegged` (refused, twelve days), `END-late`.

## Dates

`packages/shared/src/events.ts:219` `datedSeasonIndex({ yearBC, season })` = `(START_YEAR_BC - yearBC) * 4 + (season - 1)`, season 1 = Winter. Spring 298 BC is seasonIndex 9. World 2 started `2026-09-15T00:00:00Z`, so it opens 2026-09-24 00:00 UTC.

## Phase 0: recon (no code)

Confirm each reference at HEAD. If any is not as described, or the images do not map one to one onto the eleven targets below, STOP 0 with the mismatch before writing anything.

- `apps/server/src/services/story.ts`: `StoryTrigger` and `STORY_TRIGGERS` (63-76, with the `house-of-roses` entry at 75); `loadStories` (84) reads every `.json` in `content/stories`, so the new file needs no loader change; `summarizeRewards` (266) maps `change_drachmae`, `change_composure`, `change_stat` and `gain_good`; the class branch of `availableStories` (535-541).
- `packages/shared/src/story.ts`: `StoryRequirement`, `requires` and `otherwise` on `StoryChoice`, `chronicle` on a terminal, `validateStoryGraph`.
- `packages/shared/src/character.ts:17`: the class id is `shipbuilder`. `content/buildings/buildings.json` `goodLabels["naval-supplies"]` is `Naval Supplies`.
- `apps/server/src/services/story-content.test.ts`: tests 1 to 10, the House of Roses block (79-149) with its exhaustive walk (test 9), the image test (5) that checks every image path in every story file, and the DB-gated seed block with test 10 (186).
- `apps/web/public/stories/`: the `story-roses-*` files are WebP at 1134×638.
- List `/Users/macbook/Desktop/MoShip`: every file's name, format, pixel size and bytes. Map the eleven site WebPs to the targets below by name. The cast sheet and the `- MASTER.png` files stay out of the repo. Name the WebP encoder you will use (`cwebp`, or Python Pillow with WebP support); install nothing into the repo. No encoder available is a STOP 0.

| Target under `apps/web/public/stories/` | Source in `MoShip` | Node(s) |
|---|---|---|
| `story-nails-00-opening.webp` | `river-nails-00-opening` | OPEN, and the offer card |
| `story-nails-01-turning.webp` | `river-nails-01-turning` | S1 |
| `story-nails-02-gunwale.webp` | `river-nails-02-gunwale` | S2-* |
| `story-nails-03-leg.webp` | `river-nails-03-leg` | S3-* |
| `story-nails-04-evening.webp` | `river-nails-04-evening` | S4-* |
| `story-nails-05-river-way.webp` | `river-nails-05-river-way` | S5-* |
| `story-nails-06-nails.webp` | `river-nails-06-nails` | S6-high-*, S6-low-* |
| `story-nails-06r-backs.webp` | `river-nails-06r-backs` | S6R |
| `story-nails-07-dexippos.webp` | `river-nails-07-dexippos` | S7-* |
| `story-nails-08-launch.webp` | `river-nails-08-launch` | S8-* |
| `story-nails-09-segomaros.webp` | `river-nails-09-segomaros` | S9-* |

The PAY beats and the terminals carry no image.

## Phase 1: the story (one commit)

### Commit 1: `content: River Nails, a Shipbuilder story, with its eleven images`

1. Save this prompt verbatim as `docs/stories/river-nails-prompt-1.md`.
2. `content/stories/river-nails.json`: extract the JSON block under "The story file" at the end of `docs/stories/river-nails-prompt-1.md` with a script (the text between the ```` ```json ```` fence and its closing fence), write it byte for byte, and confirm it parses. Never retype it.
3. The eleven images at the target names above: a source that is already WebP at 1134×638 and under 200 KB is copied as is. Any other is encoded from its `<name> - MASTER.png` to WebP 1134 px wide, height by the master's aspect ratio (no crop), quality about 82, under 200 KB.
4. `STORY_TRIGGERS` gains, after `house-of-roses`:
   ```ts
   // Spring 298 BC is seasonIndex 9, the tenth day of a world's run.
   "river-nails": { kind: "class", classId: "shipbuilder", opensAt: { yearBC: 298, season: 2 } },
   ```
5. `apps/server/src/services/story-content.test.ts`: a `riverFile` constant beside `rosesFile`, and a "River Nails story content integrity (pure)" block after the House of Roses block, in the same idiom:
   - 11: the file parses and `validateStoryGraph` returns `[]`.
   - 12: start `OPEN`; 58 nodes, 53 scenes and 5 terminals; the terminals are exactly `END-river`, `END-wreck`, `END-sold`, `END-pegged` and `END-late`, and each carries one chronicle line equal to its one paragraph.
   - 13: every `gain_good` names a good in `content/buildings/buildings.json` `goodLabels`, and the only good the story credits is `naval-supplies`.
   - 14: an exhaustive walk from `OPEN`, following every choice and every `otherwise` branch and summing drachmae and goods as test 9 does, finds 22,032 paths: 8,640 end at `END-river`, 6,480 at `END-sold`, 4,320 at `END-wreck`, 1,728 at `END-pegged` and 864 at `END-late`. Every path credits exactly 2 `naval-supplies` when it took `quietly` or `glaukos` at an `S5-` node and none otherwise; a path ends at `END-sold` exactly when it took `sell`; the drachmae totals over all paths run from −30 to 150.
   - 15: trust routing. A walk from `OPEN` that stops at the `S5-` nodes, counting trust as in "The node scheme" above, makes 144 walks, and each reaches `S5-high` exactly when its count is 3 or more.
   - 16: the pay table. The single `wait` choice on each `PAY-nails-*` node credits these drachmae and 2 `naval-supplies`, and prestige −1 exactly on the `-pitched` nodes:

     | | clean | docked | pitched |
     |---|---|---|---|
     | high-9 | 90 | 80 | 90 |
     | low-9 | 81 | 72 | 81 |
     | high-10 | 60 | 50 | 60 |
     | low-10 | 54 | 45 | 54 |

   - In the DB-gated seed block, 17: `loadStories` also upserts `river-nails` at version 1 with 58 nodes, and `STORY_TRIGGERS["river-nails"]` equals the entry above.
   - The existing image test (5) covers the eleven files.

## Gate and STOP 1

`DATABASE_URL=…/massalia_test pnpm gate` at HEAD after the commit, ending `GATE GREEN … tree clean`. No push. Report:

```
Committed: <SHA> content: River Nails, a Shipbuilder story, with its eleven images
Gate: <the gate's last line>
Images: <target <- source, copied or encoded (encoder), pixel size, bytes, for all eleven>
Deviations: <each as a ruling for Argiris, or "none">
Post-deploy checks:
  select id, version, jsonb_array_length(tree->'nodes') from stories where id = 'river-nails';   -- 1 row, version 1, 58
  after 2026-09-24 00:00 UTC, on a Shipbuilder: the Court shows the River Nails offer card with the opening image; a non-Shipbuilder sees no card
  select status, count(*) from story_progress where story_id = 'river-nails' group by status;
```

## Scope fence

Do not touch: `content/stories/artemisia-silver.json`, `content/stories/house-of-roses.json` and their registry entries; `packages/shared/src/story.ts`; `apps/server/src/services/story.ts` beyond the one registry entry; `StorySheet.tsx`, `CourtPanel.tsx` and the Chronicle code; the events, festivals, market, barracks and worker; any other content file; any stylesheet; any guide, news or copy. No migration. No balance numbers beyond those in the story file. No refactors along the way. The masters and the cast sheet stay on the Desktop.

## The story file

```json
{
  "id": "river-nails",
  "version": 1,
  "tree": {
    "title": "River Nails",
    "start": "OPEN",
    "nodes": [
      {
        "type": "scene",
        "id": "OPEN",
        "body": {
          "paragraphs": [
            "The Lakydon at first light. On the trestles in your shed sits a fishing boat, twenty-two feet of pine on an oak keel, planked halfway up her sides. She is for old Glaukos, who has fished these waters for forty years and lost his last boat to a spring squall.",
            "This morning the watcher on the headland called the first tunny shoals, and the run will be past Massalia in a fortnight. At the pace your yard builds, each plank pegged onto the one below, she needs fourteen more days.",
            "Glaukos put it plainly when he came by at dawn. \"Every day she fishes the run is thirty drachmae in my nets, and I'll share it: thirty for every day you beat twelve. Twelve days, I pay what we agreed and fish what's left. Later than that and there's nothing left to fish.\"",
            "Beside you, Segomaros ties on his apron. He is the freeman you hired in the spring, a quiet man from up the Rhodanos who says little and works like two."
          ]
        },
        "image": "/stories/story-nails-00-opening.webp",
        "choices": [
          {
            "id": "apron",
            "text": "Tie on your apron.",
            "next": "S1"
          }
        ]
      },
      {
        "type": "scene",
        "id": "S1",
        "body": {
          "eyebrow": "Turning her",
          "paragraphs": [
            "Her port planks are on. To fit the starboard side she has to be rolled over on her trestles so the boys can reach the seams."
          ]
        },
        "image": "/stories/story-nails-01-turning.webp",
        "choices": [
          {
            "id": "ropes",
            "text": "Roll her with ropes and the boys.",
            "result": "Four boys on the ropes, Segomaros steadying the stern, and she rolls over slow and heavy. Then the aft trestle cracks.",
            "next": "S2-t0"
          },
          {
            "id": "spar",
            "text": "Lever her over with a spar.",
            "result": "The spar bites under the keel and she tips, and for a moment it's working. Then the aft trestle cracks.",
            "next": "S2-t0"
          },
          {
            "id": "ask",
            "text": "Ask Segomaros how he would do it.",
            "result": "He looks at the boat and the trestles. \"Where I come from we wouldn't turn her at all. We'd...\" \"She's a Greek boat,\" you tell him, \"and she's built the Greek way.\" He nods and takes the stern. As she rolls, the aft trestle cracks.",
            "next": "S2-t1"
          }
        ]
      },
      {
        "type": "scene",
        "id": "S2-t0",
        "body": {
          "eyebrow": "Under the gunwale",
          "paragraphs": [
            "The boat comes down on her side, and Segomaros is under her, his leg pinned between the gunwale and the floor of the shed. He isn't making a sound, which is worse than if he were."
          ]
        },
        "image": "/stories/story-nails-02-gunwale.webp",
        "choices": [
          {
            "id": "shoulder",
            "text": "Get your own shoulder under her.",
            "result": "You set your shoulder to the gunwale and heave, and for a long moment nothing moves, and then she lifts. The boys drag him clear, and the first face he looks for is yours.",
            "next": "S3-t1",
            "requires": {
              "composure": 50
            },
            "otherwise": {
              "result": "You heave until your eyes swim and she doesn't move. In the end the boys lever her up with the spar, and you've wrenched your back for nothing. Segomaros saw you try.",
              "next": "S3-t1",
              "rewards": [
                {
                  "type": "change_composure",
                  "amount": -5
                }
              ]
            }
          },
          {
            "id": "quay",
            "text": "Shout for the fishermen on the quay.",
            "result": "Half the quay comes running, and a dozen pairs of hands lift her like a basket of sprats. Segomaros is out in a moment. Nobody could say afterwards who gave the order.",
            "next": "S3-t0"
          }
        ]
      },
      {
        "type": "scene",
        "id": "S2-t1",
        "body": {
          "eyebrow": "Under the gunwale",
          "paragraphs": [
            "The boat comes down on her side, and Segomaros is under her, his leg pinned between the gunwale and the floor of the shed. He isn't making a sound, which is worse than if he were."
          ]
        },
        "image": "/stories/story-nails-02-gunwale.webp",
        "choices": [
          {
            "id": "shoulder",
            "text": "Get your own shoulder under her.",
            "result": "You set your shoulder to the gunwale and heave, and for a long moment nothing moves, and then she lifts. The boys drag him clear, and the first face he looks for is yours.",
            "next": "S3-t2",
            "requires": {
              "composure": 50
            },
            "otherwise": {
              "result": "You heave until your eyes swim and she doesn't move. In the end the boys lever her up with the spar, and you've wrenched your back for nothing. Segomaros saw you try.",
              "next": "S3-t2",
              "rewards": [
                {
                  "type": "change_composure",
                  "amount": -5
                }
              ]
            }
          },
          {
            "id": "quay",
            "text": "Shout for the fishermen on the quay.",
            "result": "Half the quay comes running, and a dozen pairs of hands lift her like a basket of sprats. Segomaros is out in a moment. Nobody could say afterwards who gave the order.",
            "next": "S3-t1"
          }
        ]
      },
      {
        "type": "scene",
        "id": "S3-t0",
        "body": {
          "eyebrow": "The leg",
          "paragraphs": [
            "His shin is split and swelling fast, and the bone may be cracked. Whatever you do now, he won't be on his feet for a month."
          ]
        },
        "image": "/stories/story-nails-03-leg.webp",
        "choices": [
          {
            "id": "bind",
            "text": "Bind it yourself.",
            "result": "You set the leg straight, pack the cut with clean linen and bind it tight against a length of offcut. He watches your hands the whole time.",
            "next": "S4-t01",
            "requires": {
              "composure": 50
            },
            "otherwise": {
              "result": "Your hands shake and the binding slips. He takes it off you without a word and does it himself.",
              "next": "S4-t01"
            }
          },
          {
            "id": "physician",
            "text": "Send the boy for the physician from the Asclepeion.",
            "result": "The physician sets the bone with one pull that makes the whole shed wince, and splints it with laths from your offcut pile. \"A month,\" he says. \"Not a day less, or he limps for life.\"",
            "next": "S4-t01",
            "rewards": [
              {
                "type": "change_drachmae",
                "amount": -5
              }
            ],
            "requires": {
              "drachmae": 5
            }
          },
          {
            "id": "himself",
            "text": "Let him bind it himself.",
            "result": "He waves you off, packs the wound with pine resin and a fistful of harbour mud, and binds it with strips of his own tunic, humming something in the river tongue. That's how they do it up the Rhodanos, he says. It'll hold.",
            "next": "S4-t01"
          }
        ]
      },
      {
        "type": "scene",
        "id": "S3-t1",
        "body": {
          "eyebrow": "The leg",
          "paragraphs": [
            "His shin is split and swelling fast, and the bone may be cracked. Whatever you do now, he won't be on his feet for a month."
          ]
        },
        "image": "/stories/story-nails-03-leg.webp",
        "choices": [
          {
            "id": "bind",
            "text": "Bind it yourself.",
            "result": "You set the leg straight, pack the cut with clean linen and bind it tight against a length of offcut. He watches your hands the whole time.",
            "next": "S4-t2",
            "requires": {
              "composure": 50
            },
            "otherwise": {
              "result": "Your hands shake and the binding slips. He takes it off you without a word and does it himself.",
              "next": "S4-t01"
            }
          },
          {
            "id": "physician",
            "text": "Send the boy for the physician from the Asclepeion.",
            "result": "The physician sets the bone with one pull that makes the whole shed wince, and splints it with laths from your offcut pile. \"A month,\" he says. \"Not a day less, or he limps for life.\"",
            "next": "S4-t2",
            "rewards": [
              {
                "type": "change_drachmae",
                "amount": -5
              }
            ],
            "requires": {
              "drachmae": 5
            }
          },
          {
            "id": "himself",
            "text": "Let him bind it himself.",
            "result": "He waves you off, packs the wound with pine resin and a fistful of harbour mud, and binds it with strips of his own tunic, humming something in the river tongue. That's how they do it up the Rhodanos, he says. It'll hold.",
            "next": "S4-t01"
          }
        ]
      },
      {
        "type": "scene",
        "id": "S3-t2",
        "body": {
          "eyebrow": "The leg",
          "paragraphs": [
            "His shin is split and swelling fast, and the bone may be cracked. Whatever you do now, he won't be on his feet for a month."
          ]
        },
        "image": "/stories/story-nails-03-leg.webp",
        "choices": [
          {
            "id": "bind",
            "text": "Bind it yourself.",
            "result": "You set the leg straight, pack the cut with clean linen and bind it tight against a length of offcut. He watches your hands the whole time.",
            "next": "S4-t3",
            "requires": {
              "composure": 50
            },
            "otherwise": {
              "result": "Your hands shake and the binding slips. He takes it off you without a word and does it himself.",
              "next": "S4-t2"
            }
          },
          {
            "id": "physician",
            "text": "Send the boy for the physician from the Asclepeion.",
            "result": "The physician sets the bone with one pull that makes the whole shed wince, and splints it with laths from your offcut pile. \"A month,\" he says. \"Not a day less, or he limps for life.\"",
            "next": "S4-t3",
            "rewards": [
              {
                "type": "change_drachmae",
                "amount": -5
              }
            ],
            "requires": {
              "drachmae": 5
            }
          },
          {
            "id": "himself",
            "text": "Let him bind it himself.",
            "result": "He waves you off, packs the wound with pine resin and a fistful of harbour mud, and binds it with strips of his own tunic, humming something in the river tongue. That's how they do it up the Rhodanos, he says. It'll hold.",
            "next": "S4-t2"
          }
        ]
      },
      {
        "type": "scene",
        "id": "S4-t01",
        "body": {
          "eyebrow": "That evening",
          "paragraphs": [
            "The shed is quiet and the boys have gone home. Segomaros sits on a coil of rope with his splinted leg out, looking at the boat."
          ]
        },
        "image": "/stories/story-nails-04-evening.webp",
        "choices": [
          {
            "id": "supper",
            "text": "Share your supper and ask about his home.",
            "result": "You sit on the rope beside him with bread and olives and let the silence run until he fills it. He talks about Arelate, and his father's yard on the river, and boats that went from keel to water in a week.",
            "next": "S5-low",
            "requires": {
              "composure": 50
            },
            "otherwise": {
              "result": "He answers in single words and keeps his eyes on the door. You leave him be.",
              "next": "S5-low"
            }
          },
          {
            "id": "wages",
            "text": "Pay him for the days he'll lose.",
            "result": "You count the coins into his hand, a month's wages. He looks at them a long time. \"Most masters would have found a new man by morning.\"",
            "next": "S5-low",
            "rewards": [
              {
                "type": "change_drachmae",
                "amount": -5
              }
            ],
            "requires": {
              "drachmae": 5
            }
          },
          {
            "id": "watchman",
            "text": "Leave him to the watchman.",
            "result": "You send the boy with bread and a blanket and go home. It has been a long day.",
            "next": "S5-low"
          }
        ]
      },
      {
        "type": "scene",
        "id": "S4-t2",
        "body": {
          "eyebrow": "That evening",
          "paragraphs": [
            "The shed is quiet and the boys have gone home. Segomaros sits on a coil of rope with his splinted leg out, looking at the boat."
          ]
        },
        "image": "/stories/story-nails-04-evening.webp",
        "choices": [
          {
            "id": "supper",
            "text": "Share your supper and ask about his home.",
            "result": "You sit on the rope beside him with bread and olives and let the silence run until he fills it. He talks about Arelate, and his father's yard on the river, and boats that went from keel to water in a week.",
            "next": "S5-high",
            "requires": {
              "composure": 50
            },
            "otherwise": {
              "result": "He answers in single words and keeps his eyes on the door. You leave him be.",
              "next": "S5-low"
            }
          },
          {
            "id": "wages",
            "text": "Pay him for the days he'll lose.",
            "result": "You count the coins into his hand, a month's wages. He looks at them a long time. \"Most masters would have found a new man by morning.\"",
            "next": "S5-high",
            "rewards": [
              {
                "type": "change_drachmae",
                "amount": -5
              }
            ],
            "requires": {
              "drachmae": 5
            }
          },
          {
            "id": "watchman",
            "text": "Leave him to the watchman.",
            "result": "You send the boy with bread and a blanket and go home. It has been a long day.",
            "next": "S5-low"
          }
        ]
      },
      {
        "type": "scene",
        "id": "S4-t3",
        "body": {
          "eyebrow": "That evening",
          "paragraphs": [
            "The shed is quiet and the boys have gone home. Segomaros sits on a coil of rope with his splinted leg out, looking at the boat."
          ]
        },
        "image": "/stories/story-nails-04-evening.webp",
        "choices": [
          {
            "id": "supper",
            "text": "Share your supper and ask about his home.",
            "result": "You sit on the rope beside him with bread and olives and let the silence run until he fills it. He talks about Arelate, and his father's yard on the river, and boats that went from keel to water in a week.",
            "next": "S5-high",
            "requires": {
              "composure": 50
            },
            "otherwise": {
              "result": "He answers in single words and keeps his eyes on the door. You leave him be.",
              "next": "S5-high"
            }
          },
          {
            "id": "wages",
            "text": "Pay him for the days he'll lose.",
            "result": "You count the coins into his hand, a month's wages. He looks at them a long time. \"Most masters would have found a new man by morning.\"",
            "next": "S5-high",
            "rewards": [
              {
                "type": "change_drachmae",
                "amount": -5
              }
            ],
            "requires": {
              "drachmae": 5
            }
          },
          {
            "id": "watchman",
            "text": "Leave him to the watchman.",
            "result": "You send the boy with bread and a blanket and go home. It has been a long day.",
            "next": "S5-high"
          }
        ]
      },
      {
        "type": "scene",
        "id": "S5-high",
        "body": {
          "eyebrow": "The river way",
          "paragraphs": [
            "The next morning he is at the shed before you, and he has drawn something in the sawdust with a stick: a plank, a rib, and a single line through both.",
            "\"You're going to be late,\" he says. \"Unless you stop cutting mortises. On the river we hang the planks on the ribs and drive an iron nail through plank and rib both, then turn the point back inside and hammer it flat. One blow for every hundred your boys make. I can't stand, but I can show them.\""
          ]
        },
        "image": "/stories/story-nails-05-river-way.webp",
        "choices": [
          {
            "id": "quietly",
            "text": "Try it on one plank, quietly.",
            "result": "You set him on a stool by the boat and let the boys nail the next plank under his eye. It goes on in an hour. You put your whole weight on it, and it holds like a wall.",
            "next": "S6-high-dexippos"
          },
          {
            "id": "glaukos",
            "text": "Ask Glaukos first.",
            "result": "You find him mending nets on the quay and tell him straight: iron nails, the river way, in his boat. He spits over the side for luck. \"The tunny never asked me how a boat was built. Just get her wet.\"",
            "next": "S6-high-glaukos"
          },
          {
            "id": "refuse",
            "text": "Refuse. Not in a Greek boat.",
            "result": "You tell him your boats are pegged the way your father pegged them, and his father before him. He shrugs, which is how river men tell you you're a fool.",
            "next": "S6R"
          }
        ]
      },
      {
        "type": "scene",
        "id": "S5-low",
        "body": {
          "eyebrow": "The river way",
          "paragraphs": [
            "The next morning he is at the shed before you, and he has drawn something in the sawdust with a stick: a plank, a rib, and a single line through both.",
            "When the boys start cutting mortises for the next plank he winces, and it isn't his leg. You ask him why, and he takes his time. \"There's a faster way. My father's way, on the river. Iron nails through plank and rib, the point turned back inside and hammered flat. No mortise, no peg, one blow for every hundred.\" He looks up at you. \"That's worth something to you, master. A tenth of what Glaukos pays you.\""
          ]
        },
        "image": "/stories/story-nails-05-river-way.webp",
        "choices": [
          {
            "id": "quietly",
            "text": "Try it on one plank, quietly.",
            "result": "You set him on a stool by the boat and let the boys nail the next plank under his eye. It goes on in an hour. You put your whole weight on it, and it holds like a wall.",
            "next": "S6-low-dexippos"
          },
          {
            "id": "glaukos",
            "text": "Ask Glaukos first.",
            "result": "You find him mending nets on the quay and tell him straight: iron nails, the river way, in his boat. He spits over the side for luck. \"The tunny never asked me how a boat was built. Just get her wet.\"",
            "next": "S6-low-glaukos"
          },
          {
            "id": "refuse",
            "text": "Refuse. Not in a Greek boat.",
            "result": "You tell him your boats are pegged the way your father pegged them, and his father before him. He shrugs, which is how river men tell you you're a fool.",
            "next": "S6R"
          }
        ]
      },
      {
        "type": "scene",
        "id": "S6-high-dexippos",
        "body": {
          "eyebrow": "A hundred and fifty nails",
          "paragraphs": [
            "A boat her size needs a hundred and fifty nails, each a finger long and square in the shank."
          ]
        },
        "image": "/stories/story-nails-06-nails.webp",
        "choices": [
          {
            "id": "smith",
            "text": "Buy them from the smith.",
            "result": "The smith by the fish market has a barrel of nails meant for roof laths. They'll do. The planks go on two a day. Segomaros calls the angles from his stool, the boys drive the nails, and the hammering never stops.",
            "next": "S7-high-9",
            "rewards": [
              {
                "type": "change_drachmae",
                "amount": -8
              }
            ],
            "requires": {
              "drachmae": 8
            }
          },
          {
            "id": "wreck",
            "text": "Pull them from the old wreck on the beach.",
            "result": "A Punic trader has lain broken on the beach since your grandfather's time, and her nails are good iron under the rust. Segomaros sits on the sand and sorts them, and you sort beside him, one by one, until the basket is full. The planks go on two a day. Segomaros calls the angles from his stool, the boys drive the nails, and the hammering never stops.",
            "next": "S7-high-9",
            "requires": {
              "composure": 50
            },
            "otherwise": {
              "result": "Half the nails snap in the pincers. It takes a second day to find enough sound ones, and that's a day the boat doesn't get back. The planks go on two a day. Segomaros calls the angles from his stool, the boys drive the nails, and the hammering never stops.",
              "next": "S7-high-10"
            }
          }
        ]
      },
      {
        "type": "scene",
        "id": "S6-high-glaukos",
        "body": {
          "eyebrow": "A hundred and fifty nails",
          "paragraphs": [
            "A boat her size needs a hundred and fifty nails, each a finger long and square in the shank."
          ]
        },
        "image": "/stories/story-nails-06-nails.webp",
        "choices": [
          {
            "id": "smith",
            "text": "Buy them from the smith.",
            "result": "The smith by the fish market has a barrel of nails meant for roof laths. They'll do. The planks go on two a day. Segomaros calls the angles from his stool, the boys drive the nails, and the hammering never stops.",
            "next": "S8-nails-high-9-clean",
            "rewards": [
              {
                "type": "change_drachmae",
                "amount": -8
              }
            ],
            "requires": {
              "drachmae": 8
            }
          },
          {
            "id": "wreck",
            "text": "Pull them from the old wreck on the beach.",
            "result": "A Punic trader has lain broken on the beach since your grandfather's time, and her nails are good iron under the rust. Segomaros sits on the sand and sorts them, and you sort beside him, one by one, until the basket is full. The planks go on two a day. Segomaros calls the angles from his stool, the boys drive the nails, and the hammering never stops.",
            "next": "S8-nails-high-9-clean",
            "requires": {
              "composure": 50
            },
            "otherwise": {
              "result": "Half the nails snap in the pincers. It takes a second day to find enough sound ones, and that's a day the boat doesn't get back. The planks go on two a day. Segomaros calls the angles from his stool, the boys drive the nails, and the hammering never stops.",
              "next": "S8-nails-high-10-clean"
            }
          }
        ]
      },
      {
        "type": "scene",
        "id": "S6-low-dexippos",
        "body": {
          "eyebrow": "A hundred and fifty nails",
          "paragraphs": [
            "A boat her size needs a hundred and fifty nails, each a finger long and square in the shank."
          ]
        },
        "image": "/stories/story-nails-06-nails.webp",
        "choices": [
          {
            "id": "smith",
            "text": "Buy them from the smith.",
            "result": "The smith by the fish market has a barrel of nails meant for roof laths. They'll do. The planks go on two a day. Segomaros calls the angles from his stool, the boys drive the nails, and the hammering never stops.",
            "next": "S7-low-9",
            "rewards": [
              {
                "type": "change_drachmae",
                "amount": -8
              }
            ],
            "requires": {
              "drachmae": 8
            }
          },
          {
            "id": "wreck",
            "text": "Pull them from the old wreck on the beach.",
            "result": "A Punic trader has lain broken on the beach since your grandfather's time, and her nails are good iron under the rust. Segomaros sits on the sand and sorts them, and you sort beside him, one by one, until the basket is full. The planks go on two a day. Segomaros calls the angles from his stool, the boys drive the nails, and the hammering never stops.",
            "next": "S7-low-9",
            "requires": {
              "composure": 50
            },
            "otherwise": {
              "result": "Half the nails snap in the pincers. It takes a second day to find enough sound ones, and that's a day the boat doesn't get back. The planks go on two a day. Segomaros calls the angles from his stool, the boys drive the nails, and the hammering never stops.",
              "next": "S7-low-10"
            }
          }
        ]
      },
      {
        "type": "scene",
        "id": "S6-low-glaukos",
        "body": {
          "eyebrow": "A hundred and fifty nails",
          "paragraphs": [
            "A boat her size needs a hundred and fifty nails, each a finger long and square in the shank."
          ]
        },
        "image": "/stories/story-nails-06-nails.webp",
        "choices": [
          {
            "id": "smith",
            "text": "Buy them from the smith.",
            "result": "The smith by the fish market has a barrel of nails meant for roof laths. They'll do. The planks go on two a day. Segomaros calls the angles from his stool, the boys drive the nails, and the hammering never stops.",
            "next": "S8-nails-low-9-clean",
            "rewards": [
              {
                "type": "change_drachmae",
                "amount": -8
              }
            ],
            "requires": {
              "drachmae": 8
            }
          },
          {
            "id": "wreck",
            "text": "Pull them from the old wreck on the beach.",
            "result": "A Punic trader has lain broken on the beach since your grandfather's time, and her nails are good iron under the rust. Segomaros sits on the sand and sorts them, and you sort beside him, one by one, until the basket is full. The planks go on two a day. Segomaros calls the angles from his stool, the boys drive the nails, and the hammering never stops.",
            "next": "S8-nails-low-9-clean",
            "requires": {
              "composure": 50
            },
            "otherwise": {
              "result": "Half the nails snap in the pincers. It takes a second day to find enough sound ones, and that's a day the boat doesn't get back. The planks go on two a day. Segomaros calls the angles from his stool, the boys drive the nails, and the hammering never stops.",
              "next": "S8-nails-low-10-clean"
            }
          }
        ]
      },
      {
        "type": "scene",
        "id": "S6R",
        "body": {
          "eyebrow": "The boys' backs",
          "paragraphs": [
            "Fourteen days of work, and twelve to do it in."
          ]
        },
        "image": "/stories/story-nails-06r-backs.webp",
        "choices": [
          {
            "id": "drive",
            "text": "Drive them, dawn to dark.",
            "result": "You're at the boat before the boys and after them, every day, and the mallets never stop. She's finished on the twelfth evening, with nothing to spare.",
            "next": "S8-pegged-12",
            "requires": {
              "composure": 50
            },
            "otherwise": {
              "result": "By the eighth day one boy is sick and another has run off to the fishing, and there's no making up the days.",
              "next": "S8-pegged-late"
            }
          },
          {
            "id": "hire",
            "text": "Hire two more hands off the quay.",
            "result": "Ten drachmae buys two men for a fortnight, and the planks go on from both sides at once. She's finished on the twelfth evening.",
            "next": "S8-pegged-12",
            "rewards": [
              {
                "type": "change_drachmae",
                "amount": -10
              }
            ],
            "requires": {
              "drachmae": 10
            }
          }
        ]
      },
      {
        "type": "scene",
        "id": "S7-high-9",
        "body": {
          "eyebrow": "Dexippos",
          "paragraphs": [
            "On the third day of nailing, Dexippos comes over from the next shed. He is master of the biggest yard on the Lakydon and a man of the old families, and he looks at the nail heads in your planks the way a priest looks at a dog in the temple.",
            "\"Barbarian iron in a Greek boat. Every fisherman knows the tunny can smell iron. Does old Glaukos know what he's buying?\""
          ]
        },
        "image": "/stories/story-nails-07-dexippos.webp",
        "choices": [
          {
            "id": "tell",
            "text": "Tell Glaukos yourself, today.",
            "result": "You're on the quay before Dexippos has finished his lunch. Glaukos hears you out and laughs. \"The tunny can smell my feet, and they still come.\"",
            "next": "S8-nails-high-9-clean"
          },
          {
            "id": "face",
            "text": "Face Dexippos down.",
            "result": "\"My shed, my boat, my name on her. Go and build your own, Dexippos.\" He looks at you, and at the boys watching, and walks back to his shed.",
            "next": "S8-nails-high-9-clean",
            "requires": {
              "prestige": 10
            },
            "otherwise": {
              "result": "He goes to Glaukos anyway, and the old man comes to the shed pale as a gull. You talk him round, but it costs you. \"Ten off my share,\" he says, \"for the scare.\"",
              "next": "S8-nails-high-9-docked"
            }
          },
          {
            "id": "pitch",
            "text": "Pitch over the nail heads and say nothing.",
            "result": "A coat of hot pitch and nobody alive can tell a nail from a peg. Dexippos watches you do it, and smiles.",
            "next": "S8-nails-high-9-pitched"
          }
        ]
      },
      {
        "type": "scene",
        "id": "S7-high-10",
        "body": {
          "eyebrow": "Dexippos",
          "paragraphs": [
            "On the third day of nailing, Dexippos comes over from the next shed. He is master of the biggest yard on the Lakydon and a man of the old families, and he looks at the nail heads in your planks the way a priest looks at a dog in the temple.",
            "\"Barbarian iron in a Greek boat. Every fisherman knows the tunny can smell iron. Does old Glaukos know what he's buying?\""
          ]
        },
        "image": "/stories/story-nails-07-dexippos.webp",
        "choices": [
          {
            "id": "tell",
            "text": "Tell Glaukos yourself, today.",
            "result": "You're on the quay before Dexippos has finished his lunch. Glaukos hears you out and laughs. \"The tunny can smell my feet, and they still come.\"",
            "next": "S8-nails-high-10-clean"
          },
          {
            "id": "face",
            "text": "Face Dexippos down.",
            "result": "\"My shed, my boat, my name on her. Go and build your own, Dexippos.\" He looks at you, and at the boys watching, and walks back to his shed.",
            "next": "S8-nails-high-10-clean",
            "requires": {
              "prestige": 10
            },
            "otherwise": {
              "result": "He goes to Glaukos anyway, and the old man comes to the shed pale as a gull. You talk him round, but it costs you. \"Ten off my share,\" he says, \"for the scare.\"",
              "next": "S8-nails-high-10-docked"
            }
          },
          {
            "id": "pitch",
            "text": "Pitch over the nail heads and say nothing.",
            "result": "A coat of hot pitch and nobody alive can tell a nail from a peg. Dexippos watches you do it, and smiles.",
            "next": "S8-nails-high-10-pitched"
          }
        ]
      },
      {
        "type": "scene",
        "id": "S7-low-9",
        "body": {
          "eyebrow": "Dexippos",
          "paragraphs": [
            "On the third day of nailing, Dexippos comes over from the next shed. He is master of the biggest yard on the Lakydon and a man of the old families, and he looks at the nail heads in your planks the way a priest looks at a dog in the temple.",
            "\"Barbarian iron in a Greek boat. Every fisherman knows the tunny can smell iron. Does old Glaukos know what he's buying?\""
          ]
        },
        "image": "/stories/story-nails-07-dexippos.webp",
        "choices": [
          {
            "id": "tell",
            "text": "Tell Glaukos yourself, today.",
            "result": "You're on the quay before Dexippos has finished his lunch. Glaukos hears you out and laughs. \"The tunny can smell my feet, and they still come.\"",
            "next": "S8-nails-low-9-clean"
          },
          {
            "id": "face",
            "text": "Face Dexippos down.",
            "result": "\"My shed, my boat, my name on her. Go and build your own, Dexippos.\" He looks at you, and at the boys watching, and walks back to his shed.",
            "next": "S8-nails-low-9-clean",
            "requires": {
              "prestige": 10
            },
            "otherwise": {
              "result": "He goes to Glaukos anyway, and the old man comes to the shed pale as a gull. You talk him round, but it costs you. \"Ten off my share,\" he says, \"for the scare.\"",
              "next": "S8-nails-low-9-docked"
            }
          },
          {
            "id": "pitch",
            "text": "Pitch over the nail heads and say nothing.",
            "result": "A coat of hot pitch and nobody alive can tell a nail from a peg. Dexippos watches you do it, and smiles.",
            "next": "S8-nails-low-9-pitched"
          }
        ]
      },
      {
        "type": "scene",
        "id": "S7-low-10",
        "body": {
          "eyebrow": "Dexippos",
          "paragraphs": [
            "On the third day of nailing, Dexippos comes over from the next shed. He is master of the biggest yard on the Lakydon and a man of the old families, and he looks at the nail heads in your planks the way a priest looks at a dog in the temple.",
            "\"Barbarian iron in a Greek boat. Every fisherman knows the tunny can smell iron. Does old Glaukos know what he's buying?\""
          ]
        },
        "image": "/stories/story-nails-07-dexippos.webp",
        "choices": [
          {
            "id": "tell",
            "text": "Tell Glaukos yourself, today.",
            "result": "You're on the quay before Dexippos has finished his lunch. Glaukos hears you out and laughs. \"The tunny can smell my feet, and they still come.\"",
            "next": "S8-nails-low-10-clean"
          },
          {
            "id": "face",
            "text": "Face Dexippos down.",
            "result": "\"My shed, my boat, my name on her. Go and build your own, Dexippos.\" He looks at you, and at the boys watching, and walks back to his shed.",
            "next": "S8-nails-low-10-clean",
            "requires": {
              "prestige": 10
            },
            "otherwise": {
              "result": "He goes to Glaukos anyway, and the old man comes to the shed pale as a gull. You talk him round, but it costs you. \"Ten off my share,\" he says, \"for the scare.\"",
              "next": "S8-nails-low-10-docked"
            }
          },
          {
            "id": "pitch",
            "text": "Pitch over the nail heads and say nothing.",
            "result": "A coat of hot pitch and nobody alive can tell a nail from a peg. Dexippos watches you do it, and smiles.",
            "next": "S8-nails-low-10-pitched"
          }
        ]
      },
      {
        "type": "scene",
        "id": "S8-nails-high-9-clean",
        "body": {
          "eyebrow": "The launch",
          "paragraphs": [
            "The morning she goes into the water, half the fishing quay turns out to watch. Glaukos has named her Galene, calm sea."
          ]
        },
        "image": "/stories/story-nails-08-launch.webp",
        "choices": [
          {
            "id": "eyes",
            "text": "Paint her eyes and pour the libation yourself.",
            "result": "You paint an eye on each side of her bow, the old way, so she can find her way home, and pour the wine over her stem. She slides into the Lakydon without a shudder.",
            "next": "PAY-nails-high-9-clean"
          },
          {
            "id": "jar",
            "text": "Let Segomaros break the jar on her bow, the river way.",
            "result": "He hobbles to the bow on his splint, breaks the jar with one swing of a mallet and shouts something in the river tongue. The fishermen cheer him louder than they have ever cheered you, and you find you don't mind.",
            "next": "PAY-nails-high-9-clean",
            "rewards": [
              {
                "type": "change_composure",
                "amount": 5
              }
            ]
          },
          {
            "id": "priest",
            "text": "Pay a priest of Artemis to bless her.",
            "result": "The priest sings and sprinkles and takes his fee, and every fisherman on the quay sees that your shed does things properly.",
            "next": "PAY-nails-high-9-clean",
            "rewards": [
              {
                "type": "change_drachmae",
                "amount": -5
              },
              {
                "type": "change_stat",
                "stat": "prestige",
                "amount": 1
              }
            ],
            "requires": {
              "drachmae": 5
            }
          }
        ]
      },
      {
        "type": "scene",
        "id": "PAY-nails-high-9-clean",
        "body": {
          "eyebrow": "Glaukos pays",
          "paragraphs": [
            "Three days to the good. Glaukos counts out ninety drachmae and slaps her side. \"Whatever you did, do it again.\""
          ]
        },
        "choices": [
          {
            "id": "wait",
            "text": "Wait for the crowd to go.",
            "result": "The river way takes thinner planks than pegs do, and the boards you didn't need go back on your stack.",
            "next": "S9-nails-9",
            "rewards": [
              {
                "type": "change_drachmae",
                "amount": 90
              },
              {
                "type": "gain_good",
                "good": "naval-supplies",
                "amount": 2
              }
            ]
          }
        ]
      },
      {
        "type": "scene",
        "id": "S8-nails-high-9-docked",
        "body": {
          "eyebrow": "The launch",
          "paragraphs": [
            "The morning she goes into the water, half the fishing quay turns out to watch. Glaukos has named her Galene, calm sea."
          ]
        },
        "image": "/stories/story-nails-08-launch.webp",
        "choices": [
          {
            "id": "eyes",
            "text": "Paint her eyes and pour the libation yourself.",
            "result": "You paint an eye on each side of her bow, the old way, so she can find her way home, and pour the wine over her stem. She slides into the Lakydon without a shudder.",
            "next": "PAY-nails-high-9-docked"
          },
          {
            "id": "jar",
            "text": "Let Segomaros break the jar on her bow, the river way.",
            "result": "He hobbles to the bow on his splint, breaks the jar with one swing of a mallet and shouts something in the river tongue. The fishermen cheer him louder than they have ever cheered you, and you find you don't mind.",
            "next": "PAY-nails-high-9-docked",
            "rewards": [
              {
                "type": "change_composure",
                "amount": 5
              }
            ]
          },
          {
            "id": "priest",
            "text": "Pay a priest of Artemis to bless her.",
            "result": "The priest sings and sprinkles and takes his fee, and every fisherman on the quay sees that your shed does things properly.",
            "next": "PAY-nails-high-9-docked",
            "rewards": [
              {
                "type": "change_drachmae",
                "amount": -5
              },
              {
                "type": "change_stat",
                "stat": "prestige",
                "amount": 1
              }
            ],
            "requires": {
              "drachmae": 5
            }
          }
        ]
      },
      {
        "type": "scene",
        "id": "PAY-nails-high-9-docked",
        "body": {
          "eyebrow": "Glaukos pays",
          "paragraphs": [
            "Three days to the good. Glaukos counts out ninety drachmae and slaps her side. \"Whatever you did, do it again.\"",
            "Then he takes ten back, for the scare."
          ]
        },
        "choices": [
          {
            "id": "wait",
            "text": "Wait for the crowd to go.",
            "result": "The river way takes thinner planks than pegs do, and the boards you didn't need go back on your stack.",
            "next": "S9-nails-9",
            "rewards": [
              {
                "type": "change_drachmae",
                "amount": 80
              },
              {
                "type": "gain_good",
                "good": "naval-supplies",
                "amount": 2
              }
            ]
          }
        ]
      },
      {
        "type": "scene",
        "id": "S8-nails-high-9-pitched",
        "body": {
          "eyebrow": "The launch",
          "paragraphs": [
            "The morning she goes into the water, half the fishing quay turns out to watch. Glaukos has named her Galene, calm sea."
          ]
        },
        "image": "/stories/story-nails-08-launch.webp",
        "choices": [
          {
            "id": "eyes",
            "text": "Paint her eyes and pour the libation yourself.",
            "result": "You paint an eye on each side of her bow, the old way, so she can find her way home, and pour the wine over her stem. She slides into the Lakydon without a shudder.",
            "next": "PAY-nails-high-9-pitched"
          },
          {
            "id": "jar",
            "text": "Let Segomaros break the jar on her bow, the river way.",
            "result": "He hobbles to the bow on his splint, breaks the jar with one swing of a mallet and shouts something in the river tongue. The fishermen cheer him louder than they have ever cheered you, and you find you don't mind.",
            "next": "PAY-nails-high-9-pitched",
            "rewards": [
              {
                "type": "change_composure",
                "amount": 5
              }
            ]
          },
          {
            "id": "priest",
            "text": "Pay a priest of Artemis to bless her.",
            "result": "The priest sings and sprinkles and takes his fee, and every fisherman on the quay sees that your shed does things properly.",
            "next": "PAY-nails-high-9-pitched",
            "rewards": [
              {
                "type": "change_drachmae",
                "amount": -5
              },
              {
                "type": "change_stat",
                "stat": "prestige",
                "amount": 1
              }
            ],
            "requires": {
              "drachmae": 5
            }
          }
        ]
      },
      {
        "type": "scene",
        "id": "PAY-nails-high-9-pitched",
        "body": {
          "eyebrow": "Glaukos pays",
          "paragraphs": [
            "As she touches the water, Dexippos says to the crowd, loud enough for all of it to hear, \"Ask him what's under the pitch.\" Glaukos pays his share anyway, because she floats. But the quay heard it.",
            "Three days to the good. Glaukos counts out ninety drachmae and slaps her side. \"Whatever you did, do it again.\""
          ]
        },
        "choices": [
          {
            "id": "wait",
            "text": "Wait for the crowd to go.",
            "result": "The river way takes thinner planks than pegs do, and the boards you didn't need go back on your stack.",
            "next": "S9-nails-9",
            "rewards": [
              {
                "type": "change_drachmae",
                "amount": 90
              },
              {
                "type": "gain_good",
                "good": "naval-supplies",
                "amount": 2
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
        "id": "S8-nails-high-10-clean",
        "body": {
          "eyebrow": "The launch",
          "paragraphs": [
            "The morning she goes into the water, half the fishing quay turns out to watch. Glaukos has named her Galene, calm sea."
          ]
        },
        "image": "/stories/story-nails-08-launch.webp",
        "choices": [
          {
            "id": "eyes",
            "text": "Paint her eyes and pour the libation yourself.",
            "result": "You paint an eye on each side of her bow, the old way, so she can find her way home, and pour the wine over her stem. She slides into the Lakydon without a shudder.",
            "next": "PAY-nails-high-10-clean"
          },
          {
            "id": "jar",
            "text": "Let Segomaros break the jar on her bow, the river way.",
            "result": "He hobbles to the bow on his splint, breaks the jar with one swing of a mallet and shouts something in the river tongue. The fishermen cheer him louder than they have ever cheered you, and you find you don't mind.",
            "next": "PAY-nails-high-10-clean",
            "rewards": [
              {
                "type": "change_composure",
                "amount": 5
              }
            ]
          },
          {
            "id": "priest",
            "text": "Pay a priest of Artemis to bless her.",
            "result": "The priest sings and sprinkles and takes his fee, and every fisherman on the quay sees that your shed does things properly.",
            "next": "PAY-nails-high-10-clean",
            "rewards": [
              {
                "type": "change_drachmae",
                "amount": -5
              },
              {
                "type": "change_stat",
                "stat": "prestige",
                "amount": 1
              }
            ],
            "requires": {
              "drachmae": 5
            }
          }
        ]
      },
      {
        "type": "scene",
        "id": "PAY-nails-high-10-clean",
        "body": {
          "eyebrow": "Glaukos pays",
          "paragraphs": [
            "Two days to the good. Sixty drachmae, as agreed. \"One more day,\" he says, \"and it would have been ninety.\""
          ]
        },
        "choices": [
          {
            "id": "wait",
            "text": "Wait for the crowd to go.",
            "result": "The river way takes thinner planks than pegs do, and the boards you didn't need go back on your stack.",
            "next": "S9-nails-10",
            "rewards": [
              {
                "type": "change_drachmae",
                "amount": 60
              },
              {
                "type": "gain_good",
                "good": "naval-supplies",
                "amount": 2
              }
            ]
          }
        ]
      },
      {
        "type": "scene",
        "id": "S8-nails-high-10-docked",
        "body": {
          "eyebrow": "The launch",
          "paragraphs": [
            "The morning she goes into the water, half the fishing quay turns out to watch. Glaukos has named her Galene, calm sea."
          ]
        },
        "image": "/stories/story-nails-08-launch.webp",
        "choices": [
          {
            "id": "eyes",
            "text": "Paint her eyes and pour the libation yourself.",
            "result": "You paint an eye on each side of her bow, the old way, so she can find her way home, and pour the wine over her stem. She slides into the Lakydon without a shudder.",
            "next": "PAY-nails-high-10-docked"
          },
          {
            "id": "jar",
            "text": "Let Segomaros break the jar on her bow, the river way.",
            "result": "He hobbles to the bow on his splint, breaks the jar with one swing of a mallet and shouts something in the river tongue. The fishermen cheer him louder than they have ever cheered you, and you find you don't mind.",
            "next": "PAY-nails-high-10-docked",
            "rewards": [
              {
                "type": "change_composure",
                "amount": 5
              }
            ]
          },
          {
            "id": "priest",
            "text": "Pay a priest of Artemis to bless her.",
            "result": "The priest sings and sprinkles and takes his fee, and every fisherman on the quay sees that your shed does things properly.",
            "next": "PAY-nails-high-10-docked",
            "rewards": [
              {
                "type": "change_drachmae",
                "amount": -5
              },
              {
                "type": "change_stat",
                "stat": "prestige",
                "amount": 1
              }
            ],
            "requires": {
              "drachmae": 5
            }
          }
        ]
      },
      {
        "type": "scene",
        "id": "PAY-nails-high-10-docked",
        "body": {
          "eyebrow": "Glaukos pays",
          "paragraphs": [
            "Two days to the good. Sixty drachmae, as agreed. \"One more day,\" he says, \"and it would have been ninety.\"",
            "Then he takes ten back, for the scare."
          ]
        },
        "choices": [
          {
            "id": "wait",
            "text": "Wait for the crowd to go.",
            "result": "The river way takes thinner planks than pegs do, and the boards you didn't need go back on your stack.",
            "next": "S9-nails-10",
            "rewards": [
              {
                "type": "change_drachmae",
                "amount": 50
              },
              {
                "type": "gain_good",
                "good": "naval-supplies",
                "amount": 2
              }
            ]
          }
        ]
      },
      {
        "type": "scene",
        "id": "S8-nails-high-10-pitched",
        "body": {
          "eyebrow": "The launch",
          "paragraphs": [
            "The morning she goes into the water, half the fishing quay turns out to watch. Glaukos has named her Galene, calm sea."
          ]
        },
        "image": "/stories/story-nails-08-launch.webp",
        "choices": [
          {
            "id": "eyes",
            "text": "Paint her eyes and pour the libation yourself.",
            "result": "You paint an eye on each side of her bow, the old way, so she can find her way home, and pour the wine over her stem. She slides into the Lakydon without a shudder.",
            "next": "PAY-nails-high-10-pitched"
          },
          {
            "id": "jar",
            "text": "Let Segomaros break the jar on her bow, the river way.",
            "result": "He hobbles to the bow on his splint, breaks the jar with one swing of a mallet and shouts something in the river tongue. The fishermen cheer him louder than they have ever cheered you, and you find you don't mind.",
            "next": "PAY-nails-high-10-pitched",
            "rewards": [
              {
                "type": "change_composure",
                "amount": 5
              }
            ]
          },
          {
            "id": "priest",
            "text": "Pay a priest of Artemis to bless her.",
            "result": "The priest sings and sprinkles and takes his fee, and every fisherman on the quay sees that your shed does things properly.",
            "next": "PAY-nails-high-10-pitched",
            "rewards": [
              {
                "type": "change_drachmae",
                "amount": -5
              },
              {
                "type": "change_stat",
                "stat": "prestige",
                "amount": 1
              }
            ],
            "requires": {
              "drachmae": 5
            }
          }
        ]
      },
      {
        "type": "scene",
        "id": "PAY-nails-high-10-pitched",
        "body": {
          "eyebrow": "Glaukos pays",
          "paragraphs": [
            "As she touches the water, Dexippos says to the crowd, loud enough for all of it to hear, \"Ask him what's under the pitch.\" Glaukos pays his share anyway, because she floats. But the quay heard it.",
            "Two days to the good. Sixty drachmae, as agreed. \"One more day,\" he says, \"and it would have been ninety.\""
          ]
        },
        "choices": [
          {
            "id": "wait",
            "text": "Wait for the crowd to go.",
            "result": "The river way takes thinner planks than pegs do, and the boards you didn't need go back on your stack.",
            "next": "S9-nails-10",
            "rewards": [
              {
                "type": "change_drachmae",
                "amount": 60
              },
              {
                "type": "gain_good",
                "good": "naval-supplies",
                "amount": 2
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
        "id": "S8-nails-low-9-clean",
        "body": {
          "eyebrow": "The launch",
          "paragraphs": [
            "The morning she goes into the water, half the fishing quay turns out to watch. Glaukos has named her Galene, calm sea."
          ]
        },
        "image": "/stories/story-nails-08-launch.webp",
        "choices": [
          {
            "id": "eyes",
            "text": "Paint her eyes and pour the libation yourself.",
            "result": "You paint an eye on each side of her bow, the old way, so she can find her way home, and pour the wine over her stem. She slides into the Lakydon without a shudder.",
            "next": "PAY-nails-low-9-clean"
          },
          {
            "id": "jar",
            "text": "Let Segomaros break the jar on her bow, the river way.",
            "result": "He hobbles to the bow on his splint, breaks the jar with one swing of a mallet and shouts something in the river tongue. The fishermen cheer him louder than they have ever cheered you, and you find you don't mind.",
            "next": "PAY-nails-low-9-clean",
            "rewards": [
              {
                "type": "change_composure",
                "amount": 5
              }
            ]
          },
          {
            "id": "priest",
            "text": "Pay a priest of Artemis to bless her.",
            "result": "The priest sings and sprinkles and takes his fee, and every fisherman on the quay sees that your shed does things properly.",
            "next": "PAY-nails-low-9-clean",
            "rewards": [
              {
                "type": "change_drachmae",
                "amount": -5
              },
              {
                "type": "change_stat",
                "stat": "prestige",
                "amount": 1
              }
            ],
            "requires": {
              "drachmae": 5
            }
          }
        ]
      },
      {
        "type": "scene",
        "id": "PAY-nails-low-9-clean",
        "body": {
          "eyebrow": "Glaukos pays",
          "paragraphs": [
            "Three days to the good. Glaukos counts out ninety drachmae and slaps her side. \"Whatever you did, do it again.\"",
            "Segomaros holds out his hand for his tenth."
          ]
        },
        "choices": [
          {
            "id": "wait",
            "text": "Wait for the crowd to go.",
            "result": "The river way takes thinner planks than pegs do, and the boards you didn't need go back on your stack.",
            "next": "S9-nails-9",
            "rewards": [
              {
                "type": "change_drachmae",
                "amount": 81
              },
              {
                "type": "gain_good",
                "good": "naval-supplies",
                "amount": 2
              }
            ]
          }
        ]
      },
      {
        "type": "scene",
        "id": "S8-nails-low-9-docked",
        "body": {
          "eyebrow": "The launch",
          "paragraphs": [
            "The morning she goes into the water, half the fishing quay turns out to watch. Glaukos has named her Galene, calm sea."
          ]
        },
        "image": "/stories/story-nails-08-launch.webp",
        "choices": [
          {
            "id": "eyes",
            "text": "Paint her eyes and pour the libation yourself.",
            "result": "You paint an eye on each side of her bow, the old way, so she can find her way home, and pour the wine over her stem. She slides into the Lakydon without a shudder.",
            "next": "PAY-nails-low-9-docked"
          },
          {
            "id": "jar",
            "text": "Let Segomaros break the jar on her bow, the river way.",
            "result": "He hobbles to the bow on his splint, breaks the jar with one swing of a mallet and shouts something in the river tongue. The fishermen cheer him louder than they have ever cheered you, and you find you don't mind.",
            "next": "PAY-nails-low-9-docked",
            "rewards": [
              {
                "type": "change_composure",
                "amount": 5
              }
            ]
          },
          {
            "id": "priest",
            "text": "Pay a priest of Artemis to bless her.",
            "result": "The priest sings and sprinkles and takes his fee, and every fisherman on the quay sees that your shed does things properly.",
            "next": "PAY-nails-low-9-docked",
            "rewards": [
              {
                "type": "change_drachmae",
                "amount": -5
              },
              {
                "type": "change_stat",
                "stat": "prestige",
                "amount": 1
              }
            ],
            "requires": {
              "drachmae": 5
            }
          }
        ]
      },
      {
        "type": "scene",
        "id": "PAY-nails-low-9-docked",
        "body": {
          "eyebrow": "Glaukos pays",
          "paragraphs": [
            "Three days to the good. Glaukos counts out ninety drachmae and slaps her side. \"Whatever you did, do it again.\"",
            "Then he takes ten back, for the scare.",
            "Segomaros holds out his hand for his tenth."
          ]
        },
        "choices": [
          {
            "id": "wait",
            "text": "Wait for the crowd to go.",
            "result": "The river way takes thinner planks than pegs do, and the boards you didn't need go back on your stack.",
            "next": "S9-nails-9",
            "rewards": [
              {
                "type": "change_drachmae",
                "amount": 72
              },
              {
                "type": "gain_good",
                "good": "naval-supplies",
                "amount": 2
              }
            ]
          }
        ]
      },
      {
        "type": "scene",
        "id": "S8-nails-low-9-pitched",
        "body": {
          "eyebrow": "The launch",
          "paragraphs": [
            "The morning she goes into the water, half the fishing quay turns out to watch. Glaukos has named her Galene, calm sea."
          ]
        },
        "image": "/stories/story-nails-08-launch.webp",
        "choices": [
          {
            "id": "eyes",
            "text": "Paint her eyes and pour the libation yourself.",
            "result": "You paint an eye on each side of her bow, the old way, so she can find her way home, and pour the wine over her stem. She slides into the Lakydon without a shudder.",
            "next": "PAY-nails-low-9-pitched"
          },
          {
            "id": "jar",
            "text": "Let Segomaros break the jar on her bow, the river way.",
            "result": "He hobbles to the bow on his splint, breaks the jar with one swing of a mallet and shouts something in the river tongue. The fishermen cheer him louder than they have ever cheered you, and you find you don't mind.",
            "next": "PAY-nails-low-9-pitched",
            "rewards": [
              {
                "type": "change_composure",
                "amount": 5
              }
            ]
          },
          {
            "id": "priest",
            "text": "Pay a priest of Artemis to bless her.",
            "result": "The priest sings and sprinkles and takes his fee, and every fisherman on the quay sees that your shed does things properly.",
            "next": "PAY-nails-low-9-pitched",
            "rewards": [
              {
                "type": "change_drachmae",
                "amount": -5
              },
              {
                "type": "change_stat",
                "stat": "prestige",
                "amount": 1
              }
            ],
            "requires": {
              "drachmae": 5
            }
          }
        ]
      },
      {
        "type": "scene",
        "id": "PAY-nails-low-9-pitched",
        "body": {
          "eyebrow": "Glaukos pays",
          "paragraphs": [
            "As she touches the water, Dexippos says to the crowd, loud enough for all of it to hear, \"Ask him what's under the pitch.\" Glaukos pays his share anyway, because she floats. But the quay heard it.",
            "Three days to the good. Glaukos counts out ninety drachmae and slaps her side. \"Whatever you did, do it again.\"",
            "Segomaros holds out his hand for his tenth."
          ]
        },
        "choices": [
          {
            "id": "wait",
            "text": "Wait for the crowd to go.",
            "result": "The river way takes thinner planks than pegs do, and the boards you didn't need go back on your stack.",
            "next": "S9-nails-9",
            "rewards": [
              {
                "type": "change_drachmae",
                "amount": 81
              },
              {
                "type": "gain_good",
                "good": "naval-supplies",
                "amount": 2
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
        "id": "S8-nails-low-10-clean",
        "body": {
          "eyebrow": "The launch",
          "paragraphs": [
            "The morning she goes into the water, half the fishing quay turns out to watch. Glaukos has named her Galene, calm sea."
          ]
        },
        "image": "/stories/story-nails-08-launch.webp",
        "choices": [
          {
            "id": "eyes",
            "text": "Paint her eyes and pour the libation yourself.",
            "result": "You paint an eye on each side of her bow, the old way, so she can find her way home, and pour the wine over her stem. She slides into the Lakydon without a shudder.",
            "next": "PAY-nails-low-10-clean"
          },
          {
            "id": "jar",
            "text": "Let Segomaros break the jar on her bow, the river way.",
            "result": "He hobbles to the bow on his splint, breaks the jar with one swing of a mallet and shouts something in the river tongue. The fishermen cheer him louder than they have ever cheered you, and you find you don't mind.",
            "next": "PAY-nails-low-10-clean",
            "rewards": [
              {
                "type": "change_composure",
                "amount": 5
              }
            ]
          },
          {
            "id": "priest",
            "text": "Pay a priest of Artemis to bless her.",
            "result": "The priest sings and sprinkles and takes his fee, and every fisherman on the quay sees that your shed does things properly.",
            "next": "PAY-nails-low-10-clean",
            "rewards": [
              {
                "type": "change_drachmae",
                "amount": -5
              },
              {
                "type": "change_stat",
                "stat": "prestige",
                "amount": 1
              }
            ],
            "requires": {
              "drachmae": 5
            }
          }
        ]
      },
      {
        "type": "scene",
        "id": "PAY-nails-low-10-clean",
        "body": {
          "eyebrow": "Glaukos pays",
          "paragraphs": [
            "Two days to the good. Sixty drachmae, as agreed. \"One more day,\" he says, \"and it would have been ninety.\"",
            "Segomaros holds out his hand for his tenth."
          ]
        },
        "choices": [
          {
            "id": "wait",
            "text": "Wait for the crowd to go.",
            "result": "The river way takes thinner planks than pegs do, and the boards you didn't need go back on your stack.",
            "next": "S9-nails-10",
            "rewards": [
              {
                "type": "change_drachmae",
                "amount": 54
              },
              {
                "type": "gain_good",
                "good": "naval-supplies",
                "amount": 2
              }
            ]
          }
        ]
      },
      {
        "type": "scene",
        "id": "S8-nails-low-10-docked",
        "body": {
          "eyebrow": "The launch",
          "paragraphs": [
            "The morning she goes into the water, half the fishing quay turns out to watch. Glaukos has named her Galene, calm sea."
          ]
        },
        "image": "/stories/story-nails-08-launch.webp",
        "choices": [
          {
            "id": "eyes",
            "text": "Paint her eyes and pour the libation yourself.",
            "result": "You paint an eye on each side of her bow, the old way, so she can find her way home, and pour the wine over her stem. She slides into the Lakydon without a shudder.",
            "next": "PAY-nails-low-10-docked"
          },
          {
            "id": "jar",
            "text": "Let Segomaros break the jar on her bow, the river way.",
            "result": "He hobbles to the bow on his splint, breaks the jar with one swing of a mallet and shouts something in the river tongue. The fishermen cheer him louder than they have ever cheered you, and you find you don't mind.",
            "next": "PAY-nails-low-10-docked",
            "rewards": [
              {
                "type": "change_composure",
                "amount": 5
              }
            ]
          },
          {
            "id": "priest",
            "text": "Pay a priest of Artemis to bless her.",
            "result": "The priest sings and sprinkles and takes his fee, and every fisherman on the quay sees that your shed does things properly.",
            "next": "PAY-nails-low-10-docked",
            "rewards": [
              {
                "type": "change_drachmae",
                "amount": -5
              },
              {
                "type": "change_stat",
                "stat": "prestige",
                "amount": 1
              }
            ],
            "requires": {
              "drachmae": 5
            }
          }
        ]
      },
      {
        "type": "scene",
        "id": "PAY-nails-low-10-docked",
        "body": {
          "eyebrow": "Glaukos pays",
          "paragraphs": [
            "Two days to the good. Sixty drachmae, as agreed. \"One more day,\" he says, \"and it would have been ninety.\"",
            "Then he takes ten back, for the scare.",
            "Segomaros holds out his hand for his tenth."
          ]
        },
        "choices": [
          {
            "id": "wait",
            "text": "Wait for the crowd to go.",
            "result": "The river way takes thinner planks than pegs do, and the boards you didn't need go back on your stack.",
            "next": "S9-nails-10",
            "rewards": [
              {
                "type": "change_drachmae",
                "amount": 45
              },
              {
                "type": "gain_good",
                "good": "naval-supplies",
                "amount": 2
              }
            ]
          }
        ]
      },
      {
        "type": "scene",
        "id": "S8-nails-low-10-pitched",
        "body": {
          "eyebrow": "The launch",
          "paragraphs": [
            "The morning she goes into the water, half the fishing quay turns out to watch. Glaukos has named her Galene, calm sea."
          ]
        },
        "image": "/stories/story-nails-08-launch.webp",
        "choices": [
          {
            "id": "eyes",
            "text": "Paint her eyes and pour the libation yourself.",
            "result": "You paint an eye on each side of her bow, the old way, so she can find her way home, and pour the wine over her stem. She slides into the Lakydon without a shudder.",
            "next": "PAY-nails-low-10-pitched"
          },
          {
            "id": "jar",
            "text": "Let Segomaros break the jar on her bow, the river way.",
            "result": "He hobbles to the bow on his splint, breaks the jar with one swing of a mallet and shouts something in the river tongue. The fishermen cheer him louder than they have ever cheered you, and you find you don't mind.",
            "next": "PAY-nails-low-10-pitched",
            "rewards": [
              {
                "type": "change_composure",
                "amount": 5
              }
            ]
          },
          {
            "id": "priest",
            "text": "Pay a priest of Artemis to bless her.",
            "result": "The priest sings and sprinkles and takes his fee, and every fisherman on the quay sees that your shed does things properly.",
            "next": "PAY-nails-low-10-pitched",
            "rewards": [
              {
                "type": "change_drachmae",
                "amount": -5
              },
              {
                "type": "change_stat",
                "stat": "prestige",
                "amount": 1
              }
            ],
            "requires": {
              "drachmae": 5
            }
          }
        ]
      },
      {
        "type": "scene",
        "id": "PAY-nails-low-10-pitched",
        "body": {
          "eyebrow": "Glaukos pays",
          "paragraphs": [
            "As she touches the water, Dexippos says to the crowd, loud enough for all of it to hear, \"Ask him what's under the pitch.\" Glaukos pays his share anyway, because she floats. But the quay heard it.",
            "Two days to the good. Sixty drachmae, as agreed. \"One more day,\" he says, \"and it would have been ninety.\"",
            "Segomaros holds out his hand for his tenth."
          ]
        },
        "choices": [
          {
            "id": "wait",
            "text": "Wait for the crowd to go.",
            "result": "The river way takes thinner planks than pegs do, and the boards you didn't need go back on your stack.",
            "next": "S9-nails-10",
            "rewards": [
              {
                "type": "change_drachmae",
                "amount": 54
              },
              {
                "type": "gain_good",
                "good": "naval-supplies",
                "amount": 2
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
        "id": "S8-pegged-12",
        "body": {
          "eyebrow": "The launch",
          "paragraphs": [
            "The morning she goes into the water, half the fishing quay turns out to watch. Glaukos has named her Galene, calm sea."
          ]
        },
        "image": "/stories/story-nails-08-launch.webp",
        "choices": [
          {
            "id": "eyes",
            "text": "Paint her eyes and pour the libation yourself.",
            "result": "You paint an eye on each side of her bow, the old way, so she can find her way home, and pour the wine over her stem. She slides into the Lakydon without a shudder.",
            "next": "PAY-pegged-12"
          },
          {
            "id": "jar",
            "text": "Let Segomaros break the jar on her bow, the river way.",
            "result": "He hobbles to the bow on his splint, breaks the jar with one swing of a mallet and shouts something in the river tongue. The fishermen cheer him louder than they have ever cheered you, and you find you don't mind.",
            "next": "PAY-pegged-12",
            "rewards": [
              {
                "type": "change_composure",
                "amount": 5
              }
            ]
          },
          {
            "id": "priest",
            "text": "Pay a priest of Artemis to bless her.",
            "result": "The priest sings and sprinkles and takes his fee, and every fisherman on the quay sees that your shed does things properly.",
            "next": "PAY-pegged-12",
            "rewards": [
              {
                "type": "change_drachmae",
                "amount": -5
              },
              {
                "type": "change_stat",
                "stat": "prestige",
                "amount": 1
              }
            ],
            "requires": {
              "drachmae": 5
            }
          }
        ]
      },
      {
        "type": "scene",
        "id": "PAY-pegged-12",
        "body": {
          "eyebrow": "Glaukos pays",
          "paragraphs": [
            "Glaukos pays the price you agreed and not an obol more, and rows out for what's left of the run."
          ]
        },
        "choices": [
          {
            "id": "wait",
            "text": "Wait for the crowd to go.",
            "next": "S9-pegged-12"
          }
        ]
      },
      {
        "type": "scene",
        "id": "S8-pegged-late",
        "body": {
          "eyebrow": "The launch",
          "paragraphs": [
            "The morning she goes into the water, half the fishing quay turns out to watch. Glaukos has named her Galene, calm sea."
          ]
        },
        "image": "/stories/story-nails-08-launch.webp",
        "choices": [
          {
            "id": "eyes",
            "text": "Paint her eyes and pour the libation yourself.",
            "result": "You paint an eye on each side of her bow, the old way, so she can find her way home, and pour the wine over her stem. She slides into the Lakydon without a shudder.",
            "next": "PAY-pegged-late"
          },
          {
            "id": "jar",
            "text": "Let Segomaros break the jar on her bow, the river way.",
            "result": "He hobbles to the bow on his splint, breaks the jar with one swing of a mallet and shouts something in the river tongue. The fishermen cheer him louder than they have ever cheered you, and you find you don't mind.",
            "next": "PAY-pegged-late",
            "rewards": [
              {
                "type": "change_composure",
                "amount": 5
              }
            ]
          },
          {
            "id": "priest",
            "text": "Pay a priest of Artemis to bless her.",
            "result": "The priest sings and sprinkles and takes his fee, and every fisherman on the quay sees that your shed does things properly.",
            "next": "PAY-pegged-late",
            "rewards": [
              {
                "type": "change_drachmae",
                "amount": -5
              },
              {
                "type": "change_stat",
                "stat": "prestige",
                "amount": 1
              }
            ],
            "requires": {
              "drachmae": 5
            }
          }
        ]
      },
      {
        "type": "scene",
        "id": "PAY-pegged-late",
        "body": {
          "eyebrow": "Glaukos pays",
          "paragraphs": [
            "The tunny have gone by. Glaukos pays what he owes."
          ]
        },
        "choices": [
          {
            "id": "wait",
            "text": "Wait for the crowd to go.",
            "result": "By evening every fisherman on the quay knows whose shed kept him.",
            "next": "S9-pegged-late",
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
        "id": "S9-nails-9",
        "body": {
          "eyebrow": "Segomaros",
          "paragraphs": [
            "When the crowd has gone, Segomaros sits at the water's edge with his leg out. Three fishermen have already asked you for boats like hers."
          ]
        },
        "image": "/stories/story-nails-09-segomaros.webp",
        "choices": [
          {
            "id": "foreman",
            "text": "Make him your foreman, with a share.",
            "result": "You put fifteen drachmae in his hand and the next boat in his charge. \"The quay wants three more. We nail them from the keel up.\" He grins, the first time you've seen him do it.",
            "next": "END-river",
            "rewards": [
              {
                "type": "change_drachmae",
                "amount": -15
              },
              {
                "type": "change_composure",
                "amount": 5
              }
            ],
            "requires": {
              "drachmae": 15
            }
          },
          {
            "id": "sell",
            "text": "Sell the river way to Dexippos.",
            "result": "Dexippos pays sixty drachmae for the method and swears you to silence about where he got it. Segomaros hears of it by nightfall, and by morning he's gone back up the Rhodanos.",
            "next": "END-sold",
            "rewards": [
              {
                "type": "change_drachmae",
                "amount": 60
              },
              {
                "type": "change_stat",
                "stat": "prestige",
                "amount": -1
              }
            ]
          },
          {
            "id": "keep",
            "text": "Keep it between the two of you.",
            "result": "You shake his hand and say nothing to anyone. The next boat goes on the trestles within the week, and the quay wonders how your shed builds so fast.",
            "next": "END-river"
          }
        ]
      },
      {
        "type": "scene",
        "id": "S9-nails-10",
        "body": {
          "eyebrow": "Segomaros",
          "paragraphs": [
            "When the crowd has gone, Segomaros sits at the water's edge with his leg out. Three fishermen have already asked you for boats like hers."
          ]
        },
        "image": "/stories/story-nails-09-segomaros.webp",
        "choices": [
          {
            "id": "foreman",
            "text": "Make him your foreman, with a share.",
            "result": "You put fifteen drachmae in his hand and the next boat in his charge. \"The quay wants three more. We nail them from the keel up.\" He grins, the first time you've seen him do it.",
            "next": "END-wreck",
            "rewards": [
              {
                "type": "change_drachmae",
                "amount": -15
              },
              {
                "type": "change_composure",
                "amount": 5
              }
            ],
            "requires": {
              "drachmae": 15
            }
          },
          {
            "id": "sell",
            "text": "Sell the river way to Dexippos.",
            "result": "Dexippos pays sixty drachmae for the method and swears you to silence about where he got it. Segomaros hears of it by nightfall, and by morning he's gone back up the Rhodanos.",
            "next": "END-sold",
            "rewards": [
              {
                "type": "change_drachmae",
                "amount": 60
              },
              {
                "type": "change_stat",
                "stat": "prestige",
                "amount": -1
              }
            ]
          },
          {
            "id": "keep",
            "text": "Keep it between the two of you.",
            "result": "You shake his hand and say nothing to anyone. The next boat goes on the trestles within the week, and the quay wonders how your shed builds so fast.",
            "next": "END-wreck"
          }
        ]
      },
      {
        "type": "scene",
        "id": "S9-pegged-12",
        "body": {
          "eyebrow": "Segomaros",
          "paragraphs": [
            "When the crowd has gone, Segomaros comes to you with his bundle over his shoulder."
          ]
        },
        "image": "/stories/story-nails-09-segomaros.webp",
        "choices": [
          {
            "id": "stay",
            "text": "Ask him to stay, at a better wage.",
            "result": "He puts the bundle down. On the next boat he doesn't say a word about nails, and you catch yourself thinking about them anyway.",
            "next": "END-pegged",
            "rewards": [
              {
                "type": "change_drachmae",
                "amount": -5
              }
            ],
            "requires": {
              "drachmae": 5
            }
          },
          {
            "id": "go",
            "text": "Let him go.",
            "result": "He goes back up the Rhodanos. In the spring you hear that a yard at Emporion has taken him on, and that their boats go into the water faster than anyone's in the west.",
            "next": "END-pegged"
          }
        ]
      },
      {
        "type": "scene",
        "id": "S9-pegged-late",
        "body": {
          "eyebrow": "Segomaros",
          "paragraphs": [
            "When the crowd has gone, Segomaros comes to you with his bundle over his shoulder."
          ]
        },
        "image": "/stories/story-nails-09-segomaros.webp",
        "choices": [
          {
            "id": "stay",
            "text": "Ask him to stay, at a better wage.",
            "result": "He puts the bundle down. On the next boat he doesn't say a word about nails, and you catch yourself thinking about them anyway.",
            "next": "END-late",
            "rewards": [
              {
                "type": "change_drachmae",
                "amount": -5
              }
            ],
            "requires": {
              "drachmae": 5
            }
          },
          {
            "id": "go",
            "text": "Let him go.",
            "result": "He goes back up the Rhodanos. In the spring you hear that a yard at Emporion has taken him on, and that their boats go into the water faster than anyone's in the west.",
            "next": "END-late"
          }
        ]
      },
      {
        "type": "terminal",
        "id": "END-sold",
        "body": {
          "paragraphs": [
            "The Galene caught the tunny run, and by winter the old yards of the Lakydon were buying nails."
          ]
        },
        "chronicle": [
          "The Galene caught the tunny run, and by winter the old yards of the Lakydon were buying nails."
        ],
        "rewards": []
      },
      {
        "type": "terminal",
        "id": "END-wreck",
        "body": {
          "paragraphs": [
            "The Galene went into the water two days early, held together with Punic nails from a wreck on the beach."
          ]
        },
        "chronicle": [
          "The Galene went into the water two days early, held together with Punic nails from a wreck on the beach."
        ],
        "rewards": []
      },
      {
        "type": "terminal",
        "id": "END-river",
        "body": {
          "paragraphs": [
            "The Galene went into the water three days early, on river nails and a freeman's word."
          ]
        },
        "chronicle": [
          "The Galene went into the water three days early, on river nails and a freeman's word."
        ],
        "rewards": []
      },
      {
        "type": "terminal",
        "id": "END-pegged",
        "body": {
          "paragraphs": [
            "The Galene caught the last of the tunny run, pegged the old way, with nothing to spare."
          ]
        },
        "chronicle": [
          "The Galene caught the last of the tunny run, pegged the old way, with nothing to spare."
        ],
        "rewards": []
      },
      {
        "type": "terminal",
        "id": "END-late",
        "body": {
          "paragraphs": [
            "The Galene went into the water after the tunny had gone, and the fishing quay knew whose shed had kept her."
          ]
        },
        "chronicle": [
          "The Galene went into the water after the tunny had gone, and the fishing quay knew whose shed had kept her."
        ],
        "rewards": []
      }
    ]
  }
}
```

END OF PROMPT

## STOP 0 ruling

STOP 0 ruling (Argiris, 23 Sept 2026):

1. story-nails-00-opening.webp is the v2 frame, encoded from `river-nails-00-opening-v2 - MASTER.png`. The shaded pass (`river-nails-00-opening.*`) stays out of the repo, like the cast sheets, the zip and the notes.
2. All eleven frames are encoded from their masters with Pillow at quality 82, at 1134×567. That keeps the masters' 2:1 shape with no crop, the same as the Artemisia art. They are not padded or cropped to 1134×638. Each must be under 200 KB.
3. Save this ruling verbatim at the end of `docs/stories/river-nails-prompt-1.md`, after END OF PROMPT, under a "STOP 0 ruling" heading, in Commit 1.

Go ahead with Commit 1 and the gate. The STOP 1 report's Images line reads "encoded from <master>" for all eleven, with each file's pixel size and bytes.
