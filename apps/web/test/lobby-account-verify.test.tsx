// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LobbyResponse } from "../src/api.js";

// The Lobby account panel is the one resend control a character-less player can
// reach: the Dashboard banner needs a character, and an unverified account
// cannot create one. It shows next to the "Not verified" pill, and only there.
const resendVerification = vi.fn();

vi.mock("../src/api.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/api.js")>();
  return { ...actual, api: { resendVerification, deleteAccount: vi.fn() } };
});

const { AccountSection } = await import("../src/lobby/LobbyPage.js");

const user = (emailVerified: boolean): LobbyResponse["user"] => ({
  email: "stuck@t",
  emailVerified,
  newsletterOptIn: false,
  isAdmin: false,
  memberSince: "2026-01-01T00:00:00.000Z",
  beta: true,
});

const panel = (emailVerified: boolean) =>
  render(
    <AccountSection
      user={user(emailVerified)}
      newsletter={false}
      savingNewsletter={false}
      newsletterNote=""
      onToggleNewsletter={() => {}}
      onLogout={() => {}}
      onAccountDeleted={() => {}}
    />,
  );

// Cheap DOM lookups, as in the other new suites: this project's run has no
// headroom over vitest's 5s default.
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 20)); });
const resendButton = () => [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Resend verification email") ?? null;

beforeEach(() => {
  resendVerification.mockReset();
  resendVerification.mockResolvedValue({ ok: true, message: "ignored" });
});
afterEach(cleanup);

describe("Lobby account section", () => {
  it("offers the resend only while unverified, sends once, and reports it", async () => {
    panel(true);
    expect(document.body.textContent).toContain("Verified");
    expect(resendButton()).toBeNull();
    cleanup();

    panel(false);
    expect(document.body.textContent).toContain("Not verified");
    fireEvent.click(resendButton()!);
    await flush();

    expect(resendVerification).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).toContain("Sent. Check your inbox.");
    // Sent is terminal for the session, so a second click cannot fire.
    expect(resendButton()!.hasAttribute("disabled")).toBe(true);
  });
});
