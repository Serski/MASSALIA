import { describe, expect, it } from "vitest";
import {
  ACTIONS_PER_DAY,
  applyDailyReset,
  remainingActions,
  spendAction,
  startingCharacter,
  type ActionState,
} from "./character.js";

describe("startingCharacter", () => {
  it("applies house ideology + house bonus + class stats together", () => {
    // Leonidas: ideology -80, +2 devotion. Priest: +3 devotion.
    const c = startingCharacter("leonidas", "priest");
    expect(c.ideology).toBe(-80);
    expect(c.devotion).toBe(5); // 2 (house) + 3 (class)
    expect(c.prestige).toBe(0);
    expect(c.militia).toBe(0);
    expect(c.intelligence).toBe(0);
    expect(c.drachmae).toBe(100);
    expect(c.growthMultiplier).toBe(1.0);
    expect(c.composure).toBe(70);
    expect(c.party).toBe("none");
  });

  it("stacks bonuses across stats (kleitos + shipbuilder)", () => {
    // Kleitos: ideology +60, +2 prestige. Shipbuilder: +2 intelligence +1 militia.
    const c = startingCharacter("kleitos", "shipbuilder");
    expect(c.ideology).toBe(60);
    expect(c.prestige).toBe(2);
    expect(c.intelligence).toBe(2);
    expect(c.militia).toBe(1);
    expect(c.devotion).toBe(0);
  });

  it("gives the slave reduced drachmae and a hidden growth multiplier", () => {
    const c = startingCharacter("xanthippos", "slave");
    expect(c.drachmae).toBe(10);
    expect(c.growthMultiplier).toBe(1.5);
    // xanthippos bonus only: +1 prestige +1 intelligence; slave adds nothing
    expect(c.prestige).toBe(1);
    expect(c.intelligence).toBe(1);
  });

  it("supports the hoplite class (renamed from military-leader)", () => {
    const c = startingCharacter("aristeides", "hoplite");
    expect(c.militia).toBe(5); // 2 (house) + 3 (class)
  });
});

describe("action economy", () => {
  it("enforces the per-day action limit", () => {
    let state: ActionState = { actionsSpentToday: 0, lastActionReset: new Date("2026-06-08T08:00:00Z") };
    const now = new Date("2026-06-08T10:00:00Z");

    const first = spendAction(state, now);
    expect(first.ok).toBe(true);
    state = first.ok ? first.state : state;
    expect(remainingActions(state.actionsSpentToday)).toBe(ACTIONS_PER_DAY - 1);

    const second = spendAction(state, now);
    expect(second.ok).toBe(true);
    state = second.ok ? second.state : state;
    expect(remainingActions(state.actionsSpentToday)).toBe(0);

    const third = spendAction(state, now);
    expect(third.ok).toBe(false);
    if (!third.ok) expect(third.reason).toBe("no_actions");
    expect(third.remaining).toBe(0);
  });

  it("lazily resets the counter across a UTC day boundary", () => {
    // Spent both actions late yesterday (UTC).
    const yesterday = { actionsSpentToday: 2, lastActionReset: new Date("2026-06-07T23:30:00Z") };

    // Same day, just after: no reset, still blocked.
    const sameDay = applyDailyReset(yesterday, new Date("2026-06-07T23:59:00Z"));
    expect(sameDay.didReset).toBe(false);
    expect(sameDay.actionsSpentToday).toBe(2);

    // Next UTC day: reset to 0.
    const nextDay = applyDailyReset(yesterday, new Date("2026-06-08T00:05:00Z"));
    expect(nextDay.didReset).toBe(true);
    expect(nextDay.actionsSpentToday).toBe(0);

    // And an action now succeeds again.
    const spend = spendAction(yesterday, new Date("2026-06-08T00:06:00Z"));
    expect(spend.ok).toBe(true);
    expect(spend.remaining).toBe(ACTIONS_PER_DAY - 1);
  });

  it("treats a null lastActionReset as needing a reset", () => {
    const reset = applyDailyReset({ actionsSpentToday: 2, lastActionReset: null }, new Date("2026-06-08T00:00:00Z"));
    expect(reset.didReset).toBe(true);
    expect(reset.actionsSpentToday).toBe(0);
  });
});
