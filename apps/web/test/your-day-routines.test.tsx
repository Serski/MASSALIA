// @vitest-environment jsdom
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, type RoutineCardView, type RoutineSet } from "../src/api.js";
import { RoutinesCard } from "../src/dashboard/panels/CourtPanel.js";

// ---------------------------------------------------------------------------
// Your Day shows what a routine needs. A kept good (the ride's horse) reads
// "Needs 1 horse" in the neutral tone; a spent good reads "−1 chicken"; short of
// the good the chip says so in the negative tone and the button is disabled; a
// waived cost shows nothing, as fees do.
// ---------------------------------------------------------------------------

const card = (over: Partial<RoutineCardView> & { id: string; label: string }): RoutineCardView => ({
  scene: "", tags: [], feedsLadder: null, costs: [], composureDelta: 0, composureReason: "", requires: null, ...over,
});
const ride = (waived: boolean) => card({ id: "routine-ride", label: "Ride the hills", requires: { good: { type: "horse", qty: 1, keep: true }, waivedBy: "horse-farm", waived } });
const offering = card({ id: "routine-offerings", label: "Make an offering", requires: { good: { type: "chicken", qty: 1 }, waived: false } });
const set = (cards: RoutineCardView[]): RoutineSet => ({ pool: "citizen", dailyPicks: 1, withdrawn: false, pickedRoutineId: null, cards, ladders: {} });
const player = (balances: Record<string, number>) => ({ balances }) as never;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function mount(cards: RoutineCardView[], balances: Record<string, number>) {
  vi.spyOn(api, "routines").mockResolvedValue(set(cards));
  const view = render(<RoutinesCard player={player(balances)} onRefresh={() => {}} />);
  await waitFor(() => expect(view.container.querySelector(".event-choice-button")).toBeTruthy());
  const button = (label: string) => [...view.container.querySelectorAll<HTMLButtonElement>(".event-choice-button")].find((b) => b.textContent?.includes(label))!;
  const chips = (b: HTMLButtonElement) => [...b.querySelectorAll(".cost-chip")].map((c) => ({ text: c.textContent, cls: c.className }));
  return { button, chips };
}

describe("Your Day shows what a routine needs", () => {
  it("the ride with a horse in the stable: 'Needs 1 horse' in the neutral tone, enabled", async () => {
    const { button, chips } = await mount([ride(false)], { horse: 1 });
    const b = button("Ride the hills");
    expect(b.disabled).toBe(false);
    expect(chips(b)).toEqual([{ text: "Needs 1 horse", cls: "cost-chip cost-neutral" }]);
  });

  it("the ride with no horse: the chip says so in the negative tone and the button is disabled", async () => {
    const { button, chips } = await mount([ride(false)], {});
    const b = button("Ride the hills");
    expect(b.disabled).toBe(true);
    expect(chips(b)).toEqual([{ text: "Needs 1 horse, you have none", cls: "cost-chip cost-negative" }]);
  });

  it("a Horse Farm waives the horse: no chip, and enabled even with none", async () => {
    const { button, chips } = await mount([ride(true)], {});
    const b = button("Ride the hills");
    expect(b.disabled).toBe(false);
    expect(chips(b)).toEqual([]);
  });

  it("the offering spends its chicken: '−1 chicken' in the negative tone, enabled with one", async () => {
    const { button, chips } = await mount([offering], { chicken: 1 });
    const b = button("Make an offering");
    expect(b.disabled).toBe(false);
    expect(chips(b)).toEqual([{ text: "−1 chicken", cls: "cost-chip cost-negative" }]);
  });
});
