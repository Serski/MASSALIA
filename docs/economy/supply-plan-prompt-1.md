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
