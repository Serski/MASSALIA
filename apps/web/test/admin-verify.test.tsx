// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The admin Verify action: the escape hatch for a player whose verification link
// expired. It only makes sense on an unverified row, so it only renders there.
const adminUsers = vi.fn();
const adminVerify = vi.fn();

vi.mock("../src/api.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/api.js")>();
  return {
    ...actual,
    api: { me: () => Promise.resolve({ user: { id: "a", email: "a@t" }, hasCharacter: true, isAdmin: true }), adminUsers, adminVerify },
  };
});

const { AdminPage } = await import("../src/AdminPage.js");

const row = (over: { id: string; email: string; emailVerifiedAt: string | null }) => ({
  createdAt: "2026-01-01T00:00:00.000Z",
  isAdmin: false,
  bannedAt: null,
  banReason: null,
  deletedAt: null,
  lastSeenAt: null,
  lastIp: null,
  characters: [],
  ...over,
});

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 20)); });
const rowOf = (email: string) => [...document.querySelectorAll("tbody tr")].find((tr) => tr.textContent?.includes(email))!;
const buttons = (el: Element) => [...el.querySelectorAll("button")];

beforeEach(() => {
  adminUsers.mockReset();
  adminVerify.mockReset();
  adminUsers.mockResolvedValue({
    users: [
      row({ id: "u1", email: "stuck@t", emailVerifiedAt: null }),
      row({ id: "u2", email: "fine@t", emailVerifiedAt: "2026-01-02T00:00:00.000Z" }),
    ],
  });
  adminVerify.mockResolvedValue({ ok: true, emailVerifiedAt: "2026-02-01T00:00:00.000Z" });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("AdminPage verify action", () => {
  it("offers Verify only on a row with no emailVerifiedAt, and calls the API", async () => {
    render(<AdminPage />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    await flush();

    expect(buttons(rowOf("stuck@t")).map((b) => b.textContent)).toContain("Verify");
    expect(buttons(rowOf("fine@t")).map((b) => b.textContent)).not.toContain("Verify");

    vi.spyOn(window, "prompt").mockReturnValue("link expired");
    vi.spyOn(window, "confirm").mockReturnValue(true);
    fireEvent.click(buttons(rowOf("stuck@t")).find((b) => b.textContent === "Verify")!);
    await flush();
    expect(adminVerify).toHaveBeenCalledTimes(1);
    expect(adminVerify).toHaveBeenCalledWith("u1", "link expired");
  });

  it("passes the Verified filter through to the user query", async () => {
    render(<AdminPage />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    await flush();
    expect(adminUsers).toHaveBeenLastCalledWith("", {});

    fireEvent.change(screen.getByLabelText(/Verified/), { target: { value: "no" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    await flush();
    expect(adminUsers).toHaveBeenLastCalledWith("", { verified: false });
  });
});
