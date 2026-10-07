# Lobby news: the invite link and the elections

Save this message verbatim as docs/lobby/news-prompt-1.md in the commit. Repo HEAD when this was drafted: ef4439a. One commit, content only: no code, no migration, no test change.

Recon: if content/news/news.json already has the entry "2026-10-invite-a-citizen" (from docs/invites/invite-news-prompt-1.md), leave it as it is and add only the elections entry. Say which in the report.

Commit "content: Lobby news for the invite link and the elections", touching only:
- docs/lobby/news-prompt-1.md (this message)
- content/news/news.json, with these entries added first in the array:

```json
{
  "id": "2026-10-first-elections",
  "date": "2026-10-07",
  "tag": "world",
  "title": "Elections are coming",
  "body": [
    "Candidacy for Archon and Ephor opens on Saturday 10 October. Voting is on Tuesday 13 October, and the winners take office on Wednesday 14 October. Each step begins at the daily rollover, 00:00 UTC.",
    "Only the Three Hundred may stand, so take your seat in the chamber now. Everyone votes."
  ]
},
{
  "id": "2026-10-invite-a-citizen",
  "date": "2026-10-07",
  "tag": "update",
  "title": "Invite a citizen",
  "body": [
    "You now have your own invite link in the Lobby, under Invite a citizen. Copy it and send it to a friend.",
    "When they take a seat among the Three Hundred, your character receives 200 drachmae. Up to 10 friends count in this world."
  ]
}
```

The Lobby sorts news newest first with ties broken by id, so the elections entry shows above the invite entry, and both above "The Lobby opens".

Gate: `DATABASE_URL=…/massalia_test pnpm gate` at HEAD after the commit; it must end `GATE GREEN: HEAD <sha>, tree clean`. If it is green, this message is the push: fast-forward only, not in the hour before the 00:00 UTC rollover. Report the Committed line, the gate line, remote HEAD, the CI run with its Gate step, Railway server on the new SHA, and `GET https://api.playmassalia.com/content/news/news.json` returning three entries, the two new ones included. A red is a STOP with the log.
