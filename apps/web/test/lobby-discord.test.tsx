// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../src/api.js";
import { GuidesPage } from "../src/lobby/GuidesPage.js";
import { RightColumn } from "../src/lobby/LobbyPage.js";
import { DISCORD_INVITE_URL } from "../src/lobby/links.js";
import { NewsPage } from "../src/lobby/NewsPage.js";

// The game's Discord invite in the Lobby (Discord 1): the frame's nav shows it
// after Guides, and the right column has a Discord box right under the Guides
// box. Every Discord link opens the one invite in a new tab.

const INVITE = "https://discord.gg/wPUJCJNSpN";
const never = () => new Promise<never>(() => {});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const expectNewTab = (a: Element) => {
  expect(a.getAttribute("href")).toBe(INVITE);
  expect(a.getAttribute("target")).toBe("_blank");
  expect(a.getAttribute("rel")).toBe("noopener noreferrer");
};

const navLinks = (container: HTMLElement) => [...container.querySelectorAll(".lobby-header-actions a")];

describe("the Lobby's Discord invite", () => {
  it("is the game's invite", () => {
    expect(DISCORD_INVITE_URL).toBe(INVITE);
  });

  it("shows Discord in the frame's nav right after Guides, opening the invite in a new tab", () => {
    const { container } = render(<GuidesPage />);
    const links = navLinks(container);
    expect(links.map((a) => a.textContent)).toEqual(["Lobby", "News", "Guides", "Discord"]);
    expectNewTab(links[3]!);
  });

  it("shows it on /news too", () => {
    vi.spyOn(api, "news").mockImplementation(never);
    const { container } = render(<NewsPage />);
    const links = navLinks(container);
    expect(links.map((a) => a.textContent)).toEqual(["Lobby", "News", "Guides", "Discord"]);
    expectNewTab(links[3]!);
  });

  it("puts a Discord box right under the Guides box, with its words and link", () => {
    const { container } = render(<RightColumn news={[]} citizens={[]} youCharacterId={null} referrals={null} />);
    const guides = container.querySelector('section[aria-label="Guides"]')!;
    const discord = guides.nextElementSibling!;
    expect(discord.getAttribute("aria-label")).toBe("Discord");
    expect(discord.querySelector("img")).toBeNull();
    expect(discord.querySelector("h3")!.textContent).toBe("Discord");
    expect(discord.querySelector("p")!.textContent).toBe("Where the houses meet, bargain and plot between seasons.");
    const link = discord.querySelector("a")!;
    expect(link.textContent).toBe("Join the Discord →");
    expectNewTab(link);
  });
});
