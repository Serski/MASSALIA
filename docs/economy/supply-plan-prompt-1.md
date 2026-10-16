Rulings on the Economy supply plan:

1. Net / day: today's actual cost, plus the warning line. Every shortfall is priced at today's season (a season is one day, so prices move daily).

2. Wording:
   - One source: "16/day · from your harvest", "99/day · from your store", "99/day · bought at 5 dr each".
   - Mixed: "115/day · 35 from your harvest · 80 from your store", "99/day · 40 from your store · 59 bought at 5 dr each".
   - Warning: "Your wheat lasts 4 more days. Then it costs 345 dr a day at today's price." Days rounded down. Shown only while the store covers today's need and lasts 7 days or fewer; one line per good.
   - "Wheat · household" and "Army · <good>" as in your mock-up.

3. Owed: the army goes in, but not inside "Owed". The army never owes; the settle disbands rows when the purse is short. Keep the Owed line as it is. Add one forward line from the same plan, in settle order: the purse, plus a day's income and grants, minus building upkeep, wages and the household's bought food, against the army's day (pay plus bought goods). When that comes up short: "Your purse won't cover tomorrow's army upkeep (Y dr). Units will leave until it can, mercenaries first."

4. Rows in training: armyUpkeep skips them, so a player training 30 peltasts sees nothing until the day they start to eat. Add one line while any row is training: "When training ends: 30 peltasts add 240 dr a day at today's price." Run them through the same plan as if they stood today (store and harvest first) and report the difference in Net / day.

5. Barracks: show the existing UPKEEP_NOTE ("Shortfalls are bought at the market's seasonal price.", barracks.ts:1250) under the Daily upkeep strip. The server sends it today and no screen renders it.

6. Tests: besides the plan's maths, one server test that seeds a player with harvest, store and an army, runs settleAll across one whole day, and checks the stock drawn and the drachmae spent against the plan's numbers. That is the guard that the tab cannot drift from the charge.

Two commits as proposed (server, then web; 4 and 5 ride in them). Gate, browser check, then STOP 1 with screenshots. No push yet.

## STOP 1 rulings (Argiris, 16 Oct 2026)

STOP 1 rulings, supply plan:

Accepted: 1 (rulings saved in the first commit), 2 (the purse line's figure is the army's whole day), 4 (Barracks note only when there is upkeep), 5 (store counts uncollected harvest; the dashboard settles on load), 7 (no plan from the server: old lines), 8 (red for the store and purse warnings, grey italic for training, no glyph).

Changes:
3. Training line: when the added cost rounds to 0, it reads "When training ends: 30 peltasts eat from your store." Otherwise as built.
6. Rounding: a line's parts must add up to its total. Round the total, round each part, and give the last part shown the remainder. The under-0.05 rule stays.

Checks:
a. The plan is built inside GET /api/buildings/mine. A throw there would break the Ledger for everyone. Wrap the plan in its own try/catch: on failure log "supply: failed <message>" and send no plan, so the tab falls back to the old lines. One test with the plan forced to throw: the payload still answers 200 without it.
b. armyDemand now reads rows in training. Confirm the Barracks Daily upkeep strip and its per-row lines still count only standing rows, as the settle charges. Pin it with a test (a roster with one ready row and one training row).

Known gap, for the docs commit: the plan prices a day at today's season, but the settle prices it at the season in force when the next settle runs. A player who next loads after the 00:00 UTC rollover pays the next season's price (Winter: grain and oil +25% on agricultural goods). The lines say "at today's price"; no fix.

Then: one web commit for 3 and 6, one server commit for a and b, one docs commit with these rulings. Gate, a quick browser recheck of the training line and a mixed line, then push fast-forward only, out by 21:00 UTC. If origin/main has moved since your base, or the gate is not green by 20:45 UTC, do not push: report and wait for 16 Oct 06:00-20:00 UTC tomorrow (17 Oct). Report CI, Pages, Railway server and worker, health, first GET /api/buildings/mine 200 and no "supply: failed" in the log.
