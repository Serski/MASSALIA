# News from Campania: the Aquilonia story for Summer 293 BC, and Samnium goes to Rome

Drafted by Claude on 14 Oct 2026 against 1e7bb23. Save this prompt as docs/stories/aquilonia-prompt-1.md in the first commit. Read AGENTS.md first. No migration, no production write. Two commits, staged by path. Recon first, and STOP only if something below does not match the code; otherwise build straight through to STOP 1. Commits stay local; no push until I say push.

## Where to build

Other sessions work in the main clone. git fetch, then build in your own worktree on a new branch from origin/main, with your own test database: create massalia_aquilonia_test, point DATABASE_URL at it, and drop it once this is pushed. Never stage, stash or commit files you did not write, and leave the main clone's main alone.

## Rulings (Argiris, 14 Oct 2026)

1. A news story for Summer 293 BC only (World 2: 15 Oct 00:00 to 16 Oct 00:00 UTC), offered to every class, made as News from Rome was (content/stories/sentinum.json, docs/stories/sentinum-prompt-1.md): a free first part; "Buy him a cup" costs 1 drachma and tells the rest, with vaguer news from Greece; "Walk on" ends with nothing. The two Samnite frames are reused unchanged; no new binaries.
2. With it, the land of Samnium (R076) and its town Spoletium become the Roman Republic's on the map. The town and its garrison stay as they are; only the owner changes. Daunia (R085, Lucenia) and Hirpini (R087, Beneventum) stay Samnite.
3. The words are those in the file below. Argiris rules on any change at STOP 1.

## Phase 0: recon (read only)

First git fetch, git status -sb and git log --oneline origin/main..main in the main clone, then make your worktree. Confirm origin/main at 1e7bb23 or a fast-forward of it (say which).

- content/stories/sentinum.json; apps/server/src/services/story.ts, STORY_TRIGGERS (around 89): "sentinum" is { kind: "dated", date: { yearBC: 295, season: 3 } }; apps/server/src/services/story-content.test.ts, test 34.
- apps/web/public/map2/politics2.json, owners: R076 (Samnium), R085 (Daunia) and R087 (Hirpini) are "samnites"; R081 (Latium) and R086 (Campania) are "roman_republic". content/map/town-military.json: spoletium is "samnites", garrison 150, no ships. packages/db/src/military.test.ts: "town owners are derived from the town's province owner".
- How the client loads politics2.json, and whether a browser could keep the old file after the deploy. Every server reader of a town's owner (mapMilitary.ts loadMilitaryOwners, mapPools.ts townContentOwner): confirm none needs more than the content change.

Then a production read, read only, through railway run --service Postgres --environment production with DATABASE_PUBLIC_URL: any march on the road to Spoletium or Samnium, and any holding there (none expected).

## Commit 1: `content: News from Campania, the Aquilonia story for Summer 293 BC`

1. Save this prompt.
2. content/stories/aquilonia.json, verbatim as below.
3. story.ts, one registry line after "sentinum":
```
   // Summer 293 BC only (seasonIndex 30, the thirty-first day of a world's run), every class.
   "aquilonia": { kind: "dated", date: { yearBC: 293, season: 3 } },
```
4. story-content.test.ts: one seed test, numbered after the file's highest: the row is seeded at version 1 with 3 nodes, and the trigger is dated Summer 293 BC.

## Commit 2: `map: Samnium and Spoletium are Rome's`

1. politics2.json: owners.R076 becomes "roman_republic".
2. town-military.json: spoletium's owner becomes "roman_republic"; garrison and ships unchanged.
3. military.test.ts, a spot check: R076 and spoletium are "roman_republic"; R085, R087, lucenia and beneventum stay "samnites".

## Gate and STOP 1

Run DATABASE_URL=…/massalia_aquilonia_test pnpm gate at HEAD after the last commit, then pnpm audit --audit-level=high. The gate must end GATE GREEN: HEAD <sha>, tree clean; the audit must exit 0. Report:

```
Committed: <SHA> <subject>, one line per commit
Branch: <branch>, built on origin/main <SHA>
Gate: <the gate's last line>, suite counts; audit exit code
Production: the read above
Client: how politics2.json is loaded, and whether a player's browser could show the old owner after the deploy
Rulings for Argiris: <each with the reason, or "none">
```

## Push (only after I reply "push")

It must be out before 23:00 UTC on 14 Oct, so the story is live when Summer opens at 00:00; never in the hour before 00:00. git fetch; if origin/main moved after your gate, rebase onto it, show each commit's git patch-id unchanged (AGENTS.md:74), and run the gate again. Then git push origin HEAD:main, a fast-forward, never forced. If CI goes red before Checkout on a registry pull, rerun it once; if Railway then leaves the commit SKIPPED, deploy it as AGENTS.md says (environmentTriggersDeploy, the server first, then the worker). Any other red is a STOP with the log. Report: remote HEAD; the CI run with its Gate and Audit steps, and the Pages run; Railway server and worker on the new SHA, no migration; API health; read only, the stories row "aquilonia" (version 1, 3 nodes); and playmassalia.com/map2/politics2.json serving R076 as "roman_republic". Then drop massalia_aquilonia_test, remove your worktree and delete the merged branch.

## Scope fence

Only the files named. No change to the story engine or its trigger kinds, the factions, the battle, raid or war rules, or any other region or town.

## content/stories/aquilonia.json, verbatim

```json
{
  "id": "aquilonia",
  "version": 1,
  "tree": {
    "title": "News from Campania",
    "start": "OPEN",
    "nodes": [
      {
        "type": "scene",
        "id": "OPEN",
        "body": {
          "paragraphs": [
            "A Campanian grain ship is in, and her crew are shouting the news up the quay before the lines are fast: Rome has taken Samnium. The last Samnite army is broken, and the hill towns have opened their gates to the consuls.",
            "Her master has found a bench at the wine-shop on the Lakydon, and he is telling it again to anyone who will stand him a cup."
          ]
        },
        "image": "/stories/story-samnite-00-news.webp",
        "choices": [
          {
            "id": "cup",
            "text": "Buy him a cup",
            "requires": { "drachmae": 1 },
            "rewards": [{ "type": "change_drachmae", "amount": -1 }],
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
            "For the price of a cup you get all of it. The Samnites swore their best men in a camp walled with linen, under an oath of death for any who ran: sixteen thousand of them, all in white. The consul Papirius met them at Aquilonia. His keeper of the sacred chickens lied about the omens, so Papirius put him in the front rank, and a Samnite javelin found him before the lines closed. The legions took it for a sign. The linen legion broke, Aquilonia fell that evening, and the other consul, Carvilius, took Cominium the same day.",
            "Before the jug is empty he has news from Greece as well, though he swears to less of it. The Boeotians have risen against Demetrius the Besieger, King of Macedon now, and the Aetolians and the Spartans are said to have sent them help.",
            "On the quay they drink to Rome, Massalia's old friend."
          ]
        },
        "image": "/stories/story-samnite-01-wine.webp",
        "rewards": [],
        "chronicle": [
          "A Campanian crew brought word up the Lakydon that Rome had taken Samnium."
        ]
      },
      {
        "type": "terminal",
        "id": "END-walk",
        "body": {
          "paragraphs": [
            "You leave him to his listeners. By evening the whole quay has Rome at the gates of every town between Campania and the Adriatic."
          ]
        },
        "rewards": []
      }
    ]
  }
}
```
