# News from Rome: the Sentinum story, offered to every class during Summer 295 BC only

Given in chat on 6 Oct 2026 (no prompt file was written for it); saved here verbatim, as AGENTS.md asks.
Repo HEAD when it was given: e3bbe4f.

## The prompt, verbatim

> ok the server is now at spring 295 BC - i want an event card with news for the summer of 295 with news of Rome - Maybe a report of the battle of the Battle of Sentinum. With two parts. Like a trader came and gave the news- We had a similar in the past- second part costs 1 drachmae and we could use the same images?

## Reading of it

- "A similar in the past" is News from Neapolis (`content/stories/samnite-war.json`, `docs/stories/samnite-war-prompt-1.md`): a three-node dated story, every class, one season only.
- Summer 295 BC is `{ yearBC: 295, season: 3 }`, seasonIndex 22, the twenty-third day of a world's run (Spring 295 BC is seasonIndex 21).
- Part one is free; part two is a choice that requires 1 drachma and charges 1 drachma; "Walk on" ends with nothing.
- The two Samnite frames are reused unchanged: `/stories/story-samnite-00-news.webp` and `/stories/story-samnite-01-wine.webp`. No new binaries.

## Scope

One commit. No migration, no client change, no worker change.
Touch only:
- content/stories/sentinum.json (new)
- apps/server/src/services/story.ts (one registry line)
- apps/server/src/services/story-content.test.ts (one seed test, numbered after the file's highest)
- docs/stories/sentinum-prompt-1.md (this file)

## Gate

`DATABASE_URL=…/massalia_test pnpm gate` at HEAD after the commit. It must end `GATE GREEN: HEAD <sha>, tree clean`.

## Push

Only after Argiris replies "push". Plain fast-forward push to main.
