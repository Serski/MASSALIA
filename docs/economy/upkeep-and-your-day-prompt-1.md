This replaces the ruling I sent before: that ruling was the last part of this prompt, which never reached you. Three changes, no migration. Save this message verbatim as docs/economy/upkeep-and-your-day-prompt-1.md in the first commit. One concern per commit, staged by path. Recon first and STOP only if something below does not match the code; otherwise build straight through to STOP 1.

Commit 1, unit upkeep (content):
In content/military/units.json, upkeepPerDay per man becomes:
- hoplite: grain 1, chicken 1, oliveoil 1 (was grain 2, oliveoil 1)
- hippeis: grain 2, chicken 1, oliveoil 1 (was grain 3, oliveoil 1)
Peltast, ekdromos and every band stay as they are. The settle, the view and the Barracks cards read upkeep from content, so no code change is expected. Tests that pin the old numbers (barracks.test.ts:410 at least) move to the new ones; STOP if a test fails for any other reason.

Commit 2, a routine can need a good without spending it:
Ride the hills needs a horse but no longer spends it.
- packages/shared/src/routines.ts: the requirement's good takes an optional keep: boolean. The schema is strict, so add it to routineRequirementSchema and to RoutineRequirement.
- content/routines/routines.json: routine-ride's good becomes { "type": "horse", "qty": 1, "keep": true }. The Horse Farm waiver stays.
- consumeRoutineRequirementInTx (apps/server/src/services/buildings.ts:1411): with keep, settle goods as now, refuse with the same 409 message when the balance is below qty, and debit nothing. ConsumeRequirement and the client's RoutineRequirementView carry keep.
- Server test: a ride with one horse leaves the horse in stock; a ride with none is refused.

Commit 3, Your Day shows what a routine needs:
Three routines need a good the card never shows: Ride the hills (1 horse, kept, waived by a Horse Farm), Evening symposion (1 wine), Make an offering (1 chicken). The routines payload already carries requires.good and waived, but RoutinesCard in apps/web/src/dashboard/panels/CourtPanel.tsx only draws the drachmae fee chip, so a player without the good clicks and only gets the server's refusal in the note under the ladders.
- Beside the fee chip, draw a chip for requires.good when not waived, using the good's usual label: "−1 wine" or "−1 chicken" for a spent good, "Needs 1 horse" in the cost-neutral tone for a kept one.
- RoutinesCard already receives player; read player.resources.balances. When the balance is below the qty and the cost is not waived, disable the button and make the chip read "Needs 1 <good>, you have none" in the negative tone.
- A waived cost shows nothing, as fees do now.
- Render test: the ride shows "Needs 1 horse", is disabled with no horses and enabled with one, and shows no chip when waived; the offering shows "−1 chicken".

STOP 1: run the full gate at HEAD. Report a Committed line per commit, the gate line, and the tests you changed with old and new values. Do not push until I say push.

## STOP 0 rulings (6 Oct 2026)

Rulings for STOP 0, then build straight through to STOP 1.

1. Commit 1 includes the unit card: replace unitUpkeep in BarracksPanel.tsx with the generic upkeepLine, so the card lists every good ("1 grain · 1 oil · 1 chicken a day"). bandUpkeep stays as it is. Add a line to the Barracks render test that a hoplite card shows its chicken.
2. Read player.balances.
3. Export RoutinesCard for the test.
4. No label map: the ids horse, wine and chicken already read as the chip text, so use the id.
5. The good chip sits beside the fee chip in the same span, in the neutral tone for a kept good, as you propose.
6. Test changes: every barracks.test.ts pin you listed moves to the new numbers. Where a map action test stocks grain and oil before an action, stock chicken the same way so its wallet assertions hold. That is a fixture change with no assertion changes. Any other red is a STOP.
