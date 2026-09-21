// @vitest-environment jsdom
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgeConfig } from "@massalia/shared";

// Character creation, source order: on a single column (under 900px) the layout
// follows the DOM, so the step's panel has to come before the recap card or a
// phone opens every step a screen below its heading. The wide layout places the
// recap in the second column with CSS, which jsdom cannot see; this pins the DOM.
const me = vi.fn();

const ageConfig: AgeConfig = {
  realMsPerGameYear: 1000,
  statCap: 100,
  statFloor: 0,
  ageOptions: [{ age: 20, label: "Twenty", note: "Longer life", startBonus: {} }],
  avatars: [{ id: "face-1", sex: "male", pool: "player", startAge: 20, label: "One", portraits: { young: "a.webp" } }],
  portraitStages: [{ fromAge: 20, stage: "young" }],
  deathAge: { min: 60, max: 90 },
  lifeStages: [{ fromAge: 20, name: "Youth" }],
  decayBands: [{ fromAge: 20, perYear: {} }],
};

vi.mock("../src/api.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/api.js")>();
  return { ...actual, api: { ageConfig: () => Promise.resolve(ageConfig), me } };
});

const { CharacterCreation } = await import("../src/CharacterCreation.js");

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("character creation layout", () => {
  it("puts the step's panel before the recap card in the document", async () => {
    me.mockResolvedValue({ user: null });
    render(<CharacterCreation onExit={() => {}} onComplete={() => {}} />);
    await waitFor(() => expect(document.querySelector(".creation-panel h1")).not.toBeNull());

    const panel = document.querySelector(".creation-panel")!;
    const summary = document.querySelector(".creation-summary")!;
    expect(panel.querySelector("h1")!.textContent).toBe("Choose your calling");
    expect(panel.compareDocumentPosition(summary) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(summary.textContent).toContain("Unnamed");
  });
});
