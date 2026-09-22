// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, type StoryAdvanceView, type StoryStateView } from "../src/api.js";
import StorySheet from "../src/dashboard/StorySheet.js";

// The story sheet's gated choices (House of Roses prompt 1): a locked choice is
// disabled and wears what it asks for, a priced one stays open and wears its
// price, a plain one advances, and a good reaches the reward strip by name.
afterEach(cleanup);

const scene = (choices: StoryStateView["choices"]): StoryStateView => ({
  storyId: "house-of-roses",
  status: "active",
  node: { id: "S4", type: "scene", body: { eyebrow: "The stairs", paragraphs: ["The flute girl does not look up."] } },
  choices,
});

const advance = (over: Partial<StoryAdvanceView> = {}): StoryAdvanceView => ({
  resultText: "The bottles are back on the shelf.",
  completed: false,
  node: { id: "S5", type: "scene", body: { paragraphs: ["The alcove is dark."] }, choices: [{ id: "on", text: "Go on" }] },
  rewardsGranted: [],
  ...over,
});

const mount = (state: StoryStateView) => {
  vi.spyOn(api, "storyStart").mockResolvedValue(state);
  return render(<StorySheet storyId="house-of-roses" title="The House of Roses" open onClose={() => {}} onRefresh={() => {}} />);
};
const buttons = () => Array.from(document.querySelectorAll<HTMLButtonElement>(".event-choice-stack .event-choice-button"));
const buttonFor = (text: string) => buttons().find((b) => b.textContent!.startsWith(text))!;

describe("story sheet · gated choices", () => {
  it("disables a locked choice and shows what it asks for", async () => {
    mount(
      scene([
        { id: "proud", text: "Speak as an equal", locked: true, requirement: "Prestige 10" },
        { id: "wait", text: "Wait" },
      ]),
    );
    await waitFor(() => expect(buttons().length).toBe(2));

    const locked = buttonFor("Speak as an equal");
    expect(locked.disabled).toBe(true);
    expect(locked.querySelector(".cost-chip")!.textContent).toBe("Needs Prestige 10");
    expect(buttonFor("Wait").disabled).toBe(false);
    expect(buttonFor("Wait").querySelector(".cost-chip")).toBeNull();
  });

  it("leaves a priced choice open and shows its price", async () => {
    mount(scene([{ id: "pay", text: "Pay Lyris", price: 5 }]));
    await waitFor(() => expect(buttons().length).toBe(1));

    const priced = buttonFor("Pay Lyris");
    expect(priced.disabled).toBe(false);
    expect(priced.querySelector(".cost-chip")!.textContent).toBe("−5 drachmae");
  });

  it("advances a plain choice by its id", async () => {
    mount(scene([{ id: "wait", text: "Wait" }]));
    const storyAdvance = vi.spyOn(api, "storyAdvance").mockResolvedValue(advance());
    await waitFor(() => expect(buttons().length).toBe(1));

    fireEvent.click(buttonFor("Wait"));
    await waitFor(() => expect(storyAdvance).toHaveBeenCalledWith("house-of-roses", "wait"));
  });

  it("names a good in the reward strip", async () => {
    mount(scene([{ id: "wait", text: "Wait" }]));
    vi.spyOn(api, "storyAdvance").mockResolvedValue(
      advance({ rewardsGranted: [{ kind: "good", good: "remedy", name: "Remedy", amount: 2 }] }),
    );
    await waitFor(() => expect(buttons().length).toBe(1));

    fireEvent.click(buttonFor("Wait"));
    await waitFor(() => expect(document.querySelector(".event-outcome")).not.toBeNull());
    expect(document.querySelector(".event-outcome .cost-chip")!.textContent).toBe("+2 Remedy");
  });
});
