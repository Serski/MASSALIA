// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// /admin shows who invited each account under its email, and how many it
// invited, in the shape of admin-verify.test.tsx.
const adminUsers = vi.fn();

vi.mock("../src/api.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/api.js")>();
  return {
    ...actual,
    api: { me: () => Promise.resolve({ user: { id: "a", email: "a@t" }, hasCharacter: true, isAdmin: true }), adminUsers },
  };
});

const { AdminPage } = await import("../src/AdminPage.js");

const row = (over: { id: string; email: string; referredBy: string | null; referralsMade: number }) => ({
  createdAt: "2026-01-01T00:00:00.000Z",
  emailVerifiedAt: "2026-01-01T00:00:00.000Z",
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
const clickButton = (el: ParentNode, text: string) => fireEvent.click([...el.querySelectorAll("button")].find((b) => b.textContent === text)!);
const rowOf = (email: string) => [...document.querySelectorAll("tbody tr")].find((tr) => tr.textContent?.includes(email))!;

beforeEach(() => {
  adminUsers.mockReset();
  adminUsers.mockResolvedValue({
    users: [
      row({ id: "u1", email: "invitee@t", referredBy: "inviter@t", referralsMade: 2 }),
      row({ id: "u2", email: "plain@t", referredBy: null, referralsMade: 0 }),
    ],
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("AdminPage referrals", () => {
  it("shows Invited by and Invited n under the email, and neither when there is nothing to say", async () => {
    render(<AdminPage />);
    await flush();
    clickButton(document, "Search");
    await flush();

    const invitee = rowOf("invitee@t").querySelector("td")!;
    expect(invitee.textContent).toContain("Invited by inviter@t");
    expect(invitee.textContent).toContain("Invited 2");

    const plain = rowOf("plain@t").querySelector("td")!;
    expect(plain.textContent).toBe("plain@t");
  });
});
