// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
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

// Cheap DOM lookups: getByRole with a name recomputes accessible names across the
// whole table, and this project's suite has no headroom over vitest's 5s default.
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 20)); });
const buttonText = (el: ParentNode) => [...el.querySelectorAll("button")].map((b) => b.textContent);
const clickButton = (el: ParentNode, text: string) => fireEvent.click([...el.querySelectorAll("button")].find((b) => b.textContent === text)!);
const rowOf = (email: string) => [...document.querySelectorAll("tbody tr")].find((tr) => tr.textContent?.includes(email))!;
const search = () => clickButton(document, "Search");

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
  it("offers Verify only on an unverified row, calls the API, and passes the Verified filter", async () => {
    render(<AdminPage />);
    await flush();
    search();
    await flush();
    expect(adminUsers).toHaveBeenLastCalledWith("", {});

    expect(buttonText(rowOf("stuck@t"))).toContain("Verify");
    expect(buttonText(rowOf("fine@t"))).not.toContain("Verify");

    vi.spyOn(window, "prompt").mockReturnValue("link expired");
    vi.spyOn(window, "confirm").mockReturnValue(true);
    clickButton(rowOf("stuck@t"), "Verify");
    await flush();
    expect(adminVerify).toHaveBeenCalledTimes(1);
    expect(adminVerify).toHaveBeenCalledWith("u1", "link expired");
    // The outcome stays in the status line; the list refresh does not replace it.
    expect(document.querySelector('[role="status"]')!.textContent).toBe("Verified stuck@t.");

    // The Verified any/yes/no control feeds the `verified` param of adminUsers.
    fireEvent.change(document.querySelector<HTMLSelectElement>("select")!, { target: { value: "no" } });
    search();
    await flush();
    expect(adminUsers).toHaveBeenLastCalledWith("", { verified: false });
  });
});
