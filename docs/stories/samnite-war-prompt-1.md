# News from Neapolis: the Samnite war story, offered to every class during Spring 298 BC only

Save this prompt as docs/stories/samnite-war-prompt-1.md in the first commit.
Spring 298 BC runs 2026-09-24 00:00 UTC to 2026-09-25 00:00 UTC. The story must be live inside that window, ideally before it opens.
Repo HEAD when this was drafted: c4cca6b. The story files are unchanged since 442216e.

## Scope
Two commits. No migration, no client change, no worker change.
Touch only:
- apps/server/src/services/story.ts
- apps/server/src/services/story.test.ts
- apps/server/src/services/story-content.test.ts
- content/stories/samnite-war.json (new)
- apps/web/public/stories/story-samnite-00-news.webp (new)
- apps/web/public/stories/story-samnite-01-wine.webp (new)
- docs/stories/samnite-war-prompt-1.md (this file)

## Phase 0: recon (read only)
Confirm the following. On any mismatch, STOP 0 and report:
- StoryTrigger in apps/server/src/services/story.ts is the union of kind "festival" and kind "class", with an optional opensAt.
- availableStories reads the character only when some trigger has kind "class". Its class branch checks classId, then opensAt against datedSeasonIndex, then storyCard.
- An existing progress row short-circuits the offer check: an active run is listed, a completed one is omitted.
- startStory gates a fresh start through availableStories and nothing else.
- advanceStory reads only the progress row, never the trigger.
- story.test.ts tests 27 and 28 use REG_CLASS on a seeded fixture story "class-story".
- /Users/macbook/Desktop/MoNews/news-samnite-war-1.png and news-samnite-war-2.png exist and are 2:1.

## Commit 1: server: a story trigger for one season, every class
1. Add to StoryTrigger:
   | { kind: "dated"; date: { yearBC: number; season: number } }
   Comment: offered to every character of every class only while the world is in that one season (season 1 = Winter, as the dated cards), then never again. A run started in the season can be finished after it.
2. availableStories: read the character when any trigger has kind "class" or "dated". For kind "dated":
   - skip when there is no character
   - skip unless gameDate(now, startedAt).seasonIndex === datedSeasonIndex(trigger.date)
   - then do the same storyCard read and "offered" entry as the class branch
   The progress-row short-circuit stays first and unchanged, so an active run is still listed after the season ends.
3. startStory and advanceStory: no change.
4. New test in story.test.ts, numbered after the file's highest, placed beside 27 and 28. Register the same seeded fixture story under { kind: "dated", date: { yearBC: 298, season: 2 } }, then check:
   - seasonIndex 8 (Winter 298 BC): a hetaira and a trader are both offered nothing, and startStory refuses the trader (not_eligible).
   - seasonIndex 9 (Spring 298 BC): both are offered it, and startStory for the trader starts at tree.start.
   - seasonIndex 10 (Summer 298 BC): the hetaira, who never started, is offered nothing, and startStory refuses her (not_eligible). The trader's run is still listed as "active".

## Commit 2: content: News from Neapolis, the Samnite war story for Spring 298 BC
1. Encode the two masters with Pillow at quality 82 to 1134x567 webp, the same as River Nails:
   - news-samnite-war-1.png -> apps/web/public/stories/story-samnite-00-news.webp
   - news-samnite-war-2.png -> apps/web/public/stories/story-samnite-01-wine.webp
2. Create content/stories/samnite-war.json with exactly this content:

{
  "id": "samnite-war",
  "version": 1,
  "tree": {
    "title": "News from Neapolis",
    "start": "OPEN",
    "nodes": [
      {
        "type": "scene",
        "id": "OPEN",
        "body": {
          "paragraphs": [
            "The first ship of the season is in from Neapolis, and her master shouts the news up the quay before the lines are made fast: Rome has declared war on the Samnites, the third war between them in fifty years.",
            "The Lucanians begged Rome for protection, and the Samnites turned Rome's heralds back with threats."
          ]
        },
        "image": "/stories/story-samnite-00-news.webp",
        "choices": [
          {
            "id": "hear",
            "text": "Hear him out",
            "requires": { "drachmae": 3 },
            "rewards": [{ "type": "change_drachmae", "amount": -3 }],
            "next": "END"
          },
          {
            "id": "walk",
            "text": "Walk on",
            "next": "END-walk"
          }
        ]
      },
      {
        "type": "terminal",
        "id": "END",
        "body": {
          "paragraphs": [
            "He tells the rest over wine. Rome has sworn the Lucanians into alliance, and the consuls are raising their legions for the summer.",
            "The old men on the quay remind everyone that Rome is Massalia's ally: when the Gauls burned Rome, Massalia sent gold toward the ransom, and Rome's thank-offering to Apollo after Veii was laid up in our treasury at Delphi."
          ]
        },
        "image": "/stories/story-samnite-01-wine.webp",
        "rewards": [],
        "chronicle": ["Word came up the Lakydon that Rome had gone to war with the Samnites."]
      },
      {
        "type": "terminal",
        "id": "END-walk",
        "body": {
          "paragraphs": ["You leave him to the crowd. By nightfall the news is all over the agora."]
        },
        "rewards": []
      }
    ]
  }
}

3. Register it in STORY_TRIGGERS:
   // Spring 298 BC only (seasonIndex 9, the tenth day of a world's run), every class.
   "samnite-war": { kind: "dated", date: { yearBC: 298, season: 2 } },
4. story-content.test.ts: add a new test after 17, "18. News from Neapolis is seeded, and its trigger offers it to every class in Spring 298 BC only". Follow the River Nails test and assert:
   - version 1
   - 3 nodes
   - STORY_TRIGGERS["samnite-war"] equals { kind: "dated", date: { yearBC: 298, season: 2 } }

## Gate
Run DATABASE_URL=…/massalia_test pnpm gate at HEAD after commit 2. It must end GATE GREEN: HEAD <sha>, tree clean.
If a red comes from a timeout in a suite this diff does not touch, STOP with the log. Never rerun to get a pass.

STOP 1. Report:
- Committed: <SHA> for each commit
- Gate: last line of the gate output, suite counts
- The two webp files' pixel sizes and byte sizes
- Any deviation, as a question for a ruling

## Push (only after I reply "push")
Fast-forward push to main. Report:
- remote HEAD
- the CI run and its Gate step
- Railway server and worker on the new SHA
- Pages green
- in production, a read-only select of the stories row for samnite-war (version 1, 3 nodes)
Confirm no migration ran.
