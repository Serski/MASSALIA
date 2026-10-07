// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LobbyReferrals } from "../src/api.js";
import { ReferralsBox } from "../src/lobby/LobbyPage.js";

// The Lobby's Invite box, rendered alone: the head note, the link, the copy
// button, each invited player's state, the empty and the used-up lines.
// Plain DOM selectors; render tests stay cheap.

const invited = (over: Partial<LobbyReferrals["invited"][number]>): LobbyReferrals["invited"][number] => ({ name: "Kleon", status: "playing", ...over });
const referrals = (list: LobbyReferrals["invited"]): LobbyReferrals => ({ code: "ABCDEF1234", reward: 200, perWorld: 10, invited: list });
const four = referrals([invited({ name: null, status: "signed-up" }), invited({ status: "playing" }), invited({ name: "Deon", status: "seated" }), invited({ name: "Nikias", status: "paid" })]);

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 10)); });
const box = () => document.querySelector(".lobby-referrals")!;
const rows = () => [...box().querySelectorAll(".lobby-referrals-list li")].map((li) => [li.querySelector("strong")!.textContent, li.querySelector("span")!.textContent]);

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("the Lobby's Invite box", () => {
  it("four invited players: the head note, the link, and a row per state", () => {
    render(<ReferralsBox referrals={four} />);
    expect(box().querySelector(".lobby-panel-head-note")!.textContent).toBe("4 of 10");
    expect(box().querySelector(".lobby-referrals-copy")!.textContent).toBe("When someone you invite takes a seat among the Three Hundred, your character receives 200 drachmae. Up to 10 invitations this world.");
    expect((box().querySelector(".lobby-referrals-field") as HTMLInputElement).value.endsWith("/?invite=ABCDEF1234")).toBe(true);
    expect(rows()).toEqual([["A new citizen", "Signed up"], ["Kleon", "In the city"], ["Deon", "Seated"], ["Nikias", "Seated · 200 paid"]]);
    expect(box().textContent).not.toContain("No one yet.");
    expect(box().textContent).not.toContain("invitations are used");
  });

  it("Copy writes the link to the clipboard once and reads Copied", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<ReferralsBox referrals={four} />);
    const button = [...box().querySelectorAll("button")].find((b) => b.textContent === "Copy")!;
    fireEvent.click(button);
    await flush();
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/?invite=ABCDEF1234`);
    expect(button.textContent).toBe("Copied");
  });

  it("without a clipboard the field is selected and the note says to copy by hand", async () => {
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    render(<ReferralsBox referrals={four} />);
    fireEvent.click([...box().querySelectorAll("button")].find((b) => b.textContent === "Copy")!);
    await flush();
    expect(box().querySelector(".lobby-referrals-note")!.textContent).toBe("Copy the link by hand.");
    expect(document.activeElement).toBe(box().querySelector(".lobby-referrals-field"));
  });

  it("ten invited players show the used-up line; none shows No one yet; null renders nothing", () => {
    const { unmount } = render(<ReferralsBox referrals={referrals(Array.from({ length: 10 }, () => invited({})))} />);
    expect(box().querySelector(".lobby-panel-head-note")!.textContent).toBe("10 of 10");
    expect(box().textContent).toContain("All 10 invitations are used this world. New sign-ups through your link do not count.");
    unmount();

    const empty = render(<ReferralsBox referrals={referrals([])} />);
    expect(box().textContent).toContain("No one yet.");
    empty.unmount();

    render(<ReferralsBox referrals={null} />);
    expect(document.querySelector(".lobby-referrals")).toBeNull();
  });
});
