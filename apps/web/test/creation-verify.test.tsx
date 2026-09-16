// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgeConfig } from "@massalia/shared";

// Character creation, unverified session: POST /characters answers 403, so the
// save step says so up front and offers the resend — the only resend control a
// character-less player could otherwise reach is the Dashboard banner, which
// needs a character. The same button also backs the 403 dead end after Save.
const me = vi.fn();
const createCharacter = vi.fn();
const resendVerification = vi.fn();

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
  return { ...actual, api: { ageConfig: () => Promise.resolve(ageConfig), me, createCharacter, resendVerification } };
});

const { CharacterCreation } = await import("../src/CharacterCreation.js");
const { ApiError } = await import("../src/api.js");

// Cheap DOM lookups on purpose: this test walks the whole 4-step wizard, and
// getByRole with a regex name recomputes an accessible name for every node in a
// DOM of ~18 image cards — enough to blow the 5s timeout under a loaded run.
const byLabel = (prefix: string) => document.querySelector<HTMLButtonElement>(`button[aria-label^="${prefix}"]`);
const continueButton = () => [...document.querySelectorAll<HTMLButtonElement>("button.primary-cta")][0]!;
const resendButton = () =>
  [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Resend verification email") ?? null;

// The Continue button is disabled until the step's choice is made, and a click on a
// disabled button is silently dropped — so wait for it to enable before clicking.
async function advance() {
  await waitFor(() => expect(continueButton().hasAttribute("disabled")).toBe(false));
  fireEvent.click(continueButton());
}

// Walk steps 1-3 (class, House, age + face + name) to reach the save step.
async function toSaveStep() {
  render(<CharacterCreation onExit={() => {}} onComplete={() => {}} />);
  await waitFor(() => expect(byLabel("Choose ")).not.toBeNull());
  fireEvent.click(byLabel("Choose ")!);
  await advance();

  await waitFor(() => expect(byLabel("Pledge to ")).not.toBeNull());
  fireEvent.click(byLabel("Pledge to ")!);
  await advance();

  // Step 3's age options and faces come from the mocked age config, so wait for them.
  await waitFor(() => expect(document.querySelector("button.creation-age-option")).not.toBeNull());
  fireEvent.click(document.querySelector<HTMLButtonElement>("button.creation-age-option")!);
  await waitFor(() => expect(byLabel("Choose Face ")).not.toBeNull());
  fireEvent.click(byLabel("Choose Face ")!);
  fireEvent.change(document.querySelector<HTMLInputElement>("input[type=text]")!, { target: { value: "Kleitos" } });
  await advance();

  await waitFor(() => expect(document.querySelector("#creation-account-form")).not.toBeNull());
}

beforeEach(() => {
  me.mockReset();
  createCharacter.mockReset();
  resendVerification.mockReset();
  resendVerification.mockResolvedValue({ ok: true, message: "ignored" });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("CharacterCreation email verification", () => {
  it("warns an unverified session on the save step and resends on click", async () => {
    me.mockResolvedValue({ user: { id: "u1", email: "stuck@t" }, hasCharacter: false, emailVerified: false });
    await toSaveStep();

    await waitFor(() => expect(resendButton()).not.toBeNull());
    expect(document.body.textContent).toContain("Your email isn’t verified yet. Verify it before you save your citizen.");

    fireEvent.click(resendButton()!);
    await waitFor(() => expect(resendVerification).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(document.body.textContent).toContain("Sent. Check your inbox, then come back and save."));
  });

  // One walk covers both verified-session cases: the notice must be absent, and a
  // save that still comes back 403 must offer the resend under the error. Walking
  // the wizard is the expensive part of this file, so it is not done twice.
  it("shows no notice for a verified session, but offers the resend if the save still 403s", async () => {
    me.mockResolvedValue({ user: { id: "u1", email: "fine@t" }, hasCharacter: false, emailVerified: true });
    createCharacter.mockRejectedValue(new ApiError("Verify your email before creating a character.", 403));
    await toSaveStep();

    expect(document.body.textContent).not.toContain("isn’t verified yet");
    expect(resendButton()).toBeNull();

    fireEvent.click(document.querySelector<HTMLInputElement>("input[type=checkbox]")!);
    fireEvent.click(continueButton());
    await waitFor(() => expect(createCharacter).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(resendButton()).not.toBeNull());
    expect(document.body.textContent).toContain("Verify your email before creating a character.");
  });

});
