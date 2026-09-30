# Bronze Left Behind, prompt 1: a class-triggered story for the Hoplite

## What this builds

A sixth story: Bronze Left Behind, a one-sitting story offered to every Hoplite. Build it from the story file you already made from the draft in your scratchpad: 14 nodes (10 scenes, 4 endings), 84 paths, six images. This is content only: the story file, the six images, one registry line and tests, in one commit. No engine, client or stylesheet change, no migration.

Rulings (Argiris):

- The story is offered to every character of class `hoplite` at once, from the deploy, with no opening date. A Hoplite created later gets it from his first dashboard load.
- The draft's text and rewards stay unchanged.
- The six frames in /Users/macbook/Desktop/MoHop are final as they are now. Use the six site WebPs at the top level of that folder. The master PNGs, the cast sheet, manifest.json, the shield-fix prompt and anything in v1/ stay on the Desktop.
- Story id `bronze-left-behind`, title "Bronze Left Behind". Images go under apps/web/public/stories/ as story-bronze-00-opening.webp, story-bronze-01-drill.webp, story-bronze-02-gate.webp, story-bronze-03-yard.webp, story-bronze-04-bronze.webp and story-bronze-05-straton.webp.

## Phase 0: recon (no code)

Confirm at HEAD (914a93b or later). If anything is not as described, STOP 0 with the mismatch before writing anything.

- apps/server/src/services/story.ts: STORY_TRIGGERS ends with "tenth-short" at 85, and the class branch of availableStories skips the date check when opensAt is absent.
- packages/shared/src/character.ts:16: the class id is `hoplite`.
- apps/server/src/services/story-content.test.ts: tenthFile at 16, and the last test is 23 (A Tenth Short, in the DB-gated seed block).
- The top level of MoHop: every file's name, format, pixel size and bytes. Map the six frames to the six targets. Each must be WebP at 1134x638 and under 200,000 bytes. Any that is not is a STOP 0; do not re-encode.
- Your scratchpad story file still parses, and validateStoryGraph returns [] against HEAD's shared package.

## Commit 1: `content: Bronze Left Behind, a Hoplite story, with its six images`

1. Save this prompt verbatim as docs/stories/bronze-left-behind-prompt-1.md.
2. content/stories/bronze-left-behind.json: your scratchpad file, copied, never retyped, at version 1. The only permitted edits are the id (to `bronze-left-behind`) and the image paths (to the six target names), if the scratchpad differs.
3. The six images, copied as is to the target names.
4. STORY_TRIGGERS gains, after "tenth-short", the comment "No opening date: every Hoplite at once, and a new one from his first day." and the line `"bronze-left-behind": { kind: "class", classId: "hoplite" },`
5. story-content.test.ts: a bronzeFile constant after tenthFile, and a "Bronze Left Behind story content integrity (pure)" block after the A Tenth Short block, in the same idiom:
   - 24: the file parses and validateStoryGraph returns [].
   - 25: 14 nodes, 10 scenes and 4 terminals. The start node carries story-bronze-00-opening.webp, and each of the six images is used by at least one node. Each terminal's chronicle lines are exactly as the draft sets them.
   - 26: rewards and gates exactly as the draft has them. Assert the complete set of reward types and stats, and every requires together with its otherwise or its paired price. Assert that no reward or requirement appears that the draft does not have.
   - 27: an exhaustive walk from the start, following every choice and every otherwise branch, finds 84 paths: 24 each at the sold, arsenal and Euboula endings and 12 at the paid ending (asserted by their terminal ids). Drachmae run from -15 to 60, militia from 0 to +4, prestige from -1 to +4.
   - In the DB-gated seed block, 28: loadStories also upserts bronze-left-behind at version 1 with 14 nodes, and STORY_TRIGGERS["bronze-left-behind"] equals { kind: "class", classId: "hoplite" }.
   - The existing image test (5) covers the six files.

## Gate and STOP 1

Run `DATABASE_URL=.../massalia_test pnpm gate` at HEAD after the commit. It must end GATE GREEN ... tree clean. No push. Report:

- Committed: <SHA> and the commit title
- Gate: <the gate's last line>, with the server and db suites' test counts and 0 skipped
- Story file: its bytes and sha256, and any edit made to the scratchpad copy (id or image paths)
- Images: for each target, its source, pixel size and bytes
- Endings: each terminal id with its Chronicle line(s)
- Frame 03: the scorpion and gorgon devices are on Bryas's men's shields; no shield in any frame carries lettering
- Deviations: each as a ruling for Argiris, or "none"
- Post-deploy checks:
  select id, version, jsonb_array_length(tree->'nodes') from stories where id = 'bronze-left-behind';   -- 1 row, version 1, 14
  on a Hoplite, right after the deploy: the Court shows the Bronze Left Behind offer card with the opening image; a non-Hoplite sees no card

## Scope fence

Do not touch: the other five story files and their registry entries; packages/shared/src/story.ts; story.ts beyond the one registry entry; the client, the Chronicle code, the barracks and contracts; any other content file, stylesheet or copy. No migration. No balance numbers beyond the draft's. Nothing else from MoHop enters the repo.
