# Hostile actions 1: a year's guard on the target, and militia against the blade

Given by Argiris in chat on 13 Oct 2026 against 45319b7, after two poisonings on 12 Oct. There was no prompt file; this one records the instruction and the rulings as they were given.

## The instruction (Argiris, 13 Oct 2026, verbatim)

> Ok i want to edit this. I want the 48h to be 96h - one in game year. I also want to not be possible for others to assasinate or poison too. I also want the mil stat play a role too in the defence of assasination- half of that of the intell stat

## What it is

Three changes to poison and assassination (`apps/server/src/services/interactions.ts`):

1. The hostile cooldown is 96 hours, one game year, where it was 48.
2. The cooldown guards the target against every hand: after any attempt on a character, by poison or by the blade, nobody may try either on that character until the window has passed. A refused attempt spends nothing. The attacker stays free to strike someone else.
3. The target's militia defends against assassination at half the weight of intelligence. Poison is unchanged.

## Asked at the stop (Claude, 13 Oct 2026)

1. The words of the lock line, now that the lock may be someone else's.
2. Whether every oligarch should see the lock on a guarded character's profile, which would show a failed attempt to the whole chamber.
3. Whether to record the instruction under `docs/`.

## Rulings (Argiris, 13 Oct 2026, verbatim)

> Rulings (13 Oct):
> 1. No dash in the line. The character who struck sees, on the profile and on a refused attempt: "Your hand is already turned against them. A year must pass before anyone may strike again (3d 2h left)."
> 2. Keep a failed attempt secret. Every other oligarch sees the Poison and Assassinate buttons as usual; only when he tries does the server refuse, with: "Their household is on guard. A year must pass before anyone may strike at them (3d 2h left)." Nothing is spent, as now. The victim's own profile shows nothing. Add tests: a third oligarch's profile shows no lock; his attempt is refused with that line and spends nothing.
> 3. Yes, record it: write this instruction and these rulings to a prompt file under docs/politics/, in its own docs commit.
>
> Then one commit per change plus the docs commit, run the gate at HEAD and the audit, and if both are green push (plain git push, not at or after 23:00 UTC) and report: remote HEAD, the CI run with Gate and Audit, Pages, Railway server and worker on the new SHA, no migration, API health.

## Scope

Four commits: this file, then one for each change. Touched:

- docs/politics/hostile-actions-prompt-1.md (this file)
- content/politics/interactions.json (`hostileCooldownHours`, and `militiaDefenseWeight` on the assassinate action)
- packages/shared/src/interactions.ts and interactions.test.ts (the config schema, `assassinateSuccessChance`)
- apps/server/src/services/interactions.ts and interactions.test.ts (the cooldown read, the two lock lines, the locks of the two attempts, the blade's defense)

No migration, and no change to the web client: it already shows the server's line when an attempt is refused.

## How it works

- The window is read from the ledger: the newest poison or assassinate row against the target, by any hand, starts it. It therefore applies to attempts made before this shipped.
- Each attempt takes both players' locks in id order, as a gift does, so two houses striking one target together resolve to one attempt and one refusal.
- The blade's defense is the target's intelligence, plus militia times `militiaDefenseWeight`, plus bodyguards, plus a spymaster on guard. Militia is read with its traits, as intelligence is.
