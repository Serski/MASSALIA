// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
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

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 20)); });
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole("button", { name }));

// Walk steps 1-3 (class, House, age + face + name) to reach the save step.
async function toSaveStep() {
  render(<CharacterCreation onExit={() => {}} onComplete={() => {}} />);
  await flush();
  fireEvent.click(screen.getAllByRole("button", { name: /^Choose / })[0]!);
  click("Continue →");
  await flush();
  fireEvent.click(screen.getAllByRole("button", { name: /^Pledge to / })[0]!);
  click("Continue →");
  await flush();
  click(/Twenty/);
  await flush();
  fireEvent.click(screen.getAllByRole("button", { name: /^Choose Face / })[0]!);
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Kleitos" } });
  click("Continue →");
  await flush();
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

    expect(screen.getByText(/isn’t verified yet\. Verify it before you save your citizen\./)).toBeTruthy();
    const resend = screen.getByRole("button", { name: "Resend verification email" });

    fireEvent.click(resend);
    await flush();
    expect(resendVerification).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Sent\. Check your inbox, then come back and save\./)).toBeTruthy();
  });

  it("shows no notice for a verified session", async () => {
    me.mockResolvedValue({ user: { id: "u1", email: "fine@t" }, hasCharacter: false, emailVerified: true });
    await toSaveStep();

    expect(screen.queryByText(/isn’t verified yet/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Resend verification email" })).toBeNull();
  });

  it("offers the resend under the error when the save itself comes back 403", async () => {
    me.mockResolvedValue({ user: { id: "u1", email: "fine@t" }, hasCharacter: false, emailVerified: true });
    createCharacter.mockRejectedValue(new ApiError("Verify your email before creating a character.", 403));
    await toSaveStep();

    expect(screen.queryByRole("button", { name: "Resend verification email" })).toBeNull();
    fireEvent.click(screen.getByRole("checkbox"));
    click("Save character");
    await flush();

    expect(createCharacter).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Resend verification email" })).toBeTruthy();
  });
});
