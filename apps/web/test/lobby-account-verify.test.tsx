// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
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

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 20)); });

beforeEach(() => {
  resendVerification.mockReset();
  resendVerification.mockResolvedValue({ ok: true, message: "ignored" });
});
afterEach(cleanup);

describe("Lobby account section", () => {
  it("offers the resend only while the account is unverified", () => {
    panel(false);
    expect(screen.getByText("Not verified")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Resend verification email" })).toBeTruthy();
    cleanup();

    panel(true);
    expect(screen.getByText("Verified")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Resend verification email" })).toBeNull();
  });

  it("sends once and reports it", async () => {
    panel(false);
    const button = screen.getByRole("button", { name: "Resend verification email" });
    fireEvent.click(button);
    await flush();

    expect(resendVerification).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Sent. Check your inbox.")).toBeTruthy();
    // Sent is terminal for the session, so a second click cannot fire.
    expect(screen.getByRole("button", { name: "Resend verification email" }).hasAttribute("disabled")).toBe(true);
  });
});
