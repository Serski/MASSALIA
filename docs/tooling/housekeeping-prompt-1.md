Housekeeping batch, no migration. Save this message verbatim as docs/tooling/housekeeping-prompt-1.md in the first commit. One concern per commit, staged by path. Recon first and STOP only if something below does not match the code; otherwise build straight through to STOP 1.

Commit 1, docs only:
- This prompt file.
- docs/tooling/vitest-4-upgrade-prompt-1.md: append your final report and my two rulings from tonight, verbatim, under "STOP rulings (6 Oct 2026)".
- docs/economy/economy-prompt-1.md: append under "STOP 1 ruling (4 Oct 2026)": "The verbatim text was not kept. The work as shipped in the commits ending 7152e21 is the record."
- docs/politics/politics-prompt-2.md: append "No STOP 1 ruling was recorded. The work shipped as 1585bc5."
- docs/mobile/mobile-prompt-1.md, only if its STOP 1 ruling is missing, append under "STOP 1 ruling (21 Sept 2026), summary": "The agent's browser pane draws the coin and amphora emoji about 16px wide against iOS Safari's 20px, so its chip measurements run about 4px short and the phone is the wider case. 'Pytheas' at Dashboard.tsx:50 is the client's placeholder painted while the payload is absent, not a server rename."
- docs/art/art-prompt-3.md, only if its STOP 1 ruling is missing, append under "STOP 1 ruling (4 Oct 2026), summary": "The card is accepted as drawn, with the black fade reaching over the left of the acropolis. Push approved."

Commit 2, listEvents loads once:
apps/server/src/services/eventEngine.ts:66 reads and parses all 25 event files on every call. Content only changes with a deploy, so cache the loaded events for the life of the process: cache the promise, and clear it if the load throws so the boot check at index.ts:101 still fails loudly. Every caller will share one array, so confirm no caller mutates the events or their choices, and STOP if one does. No behaviour change.

Commit 3, lapsed cards are closed:
In applyExpiredDefaults (apps/server/src/services/dailyDecisions.ts:45), a past unresolved card whose event has no defaultChoiceId is marked resolved = true, resolvedChoiceId = "expired" (the word packages/db/src/olympiad.ts:309 already uses), resolvedByDefault = false. No effects, no composure, no event history, no Chronicle line. Guard the update on resolved = false as the claim does. The unknown-event branch stays as it is. Rewrite test (b) in dailyDecisions.test.ts to pin the new state and keep its no-effect assertions; no other test changes. No backfill: each character's backlog closes at its next first load of a day.

Commit 4, fast-uri, lockfile only:
If fast-uri 3.1.8 and 4.1.5 are within range for every dependant, update the lockfile only, as was done for source-map-js. If either is out of range, skip this commit and report. esbuild under drizzle-kit waits for a later dependency refresh.

Dependabot: close pull request #14 with a comment that bffc37c supersedes it, and close any other open Dependabot pull request whose bump main already contains. Leave #26 and the rest open and list them in the report with what each bumps.

STOP 1: run the full gate at HEAD and the audit. Report a Committed line per commit, the gate line, the audit result, which Dependabot alerts close on push, and which pull requests you closed. Do not push until I say push.
