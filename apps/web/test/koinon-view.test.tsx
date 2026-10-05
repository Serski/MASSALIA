// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, type KoinonArmies, type KoinonLastMuster, type KoinonMember, type KoinonMuster, type KoinonMusterMine, type KoinonMusterTargets, type KoinonPage, type KoinonRole } from "../src/api.js";
import { awayLine, KoinonView } from "../src/dashboard/panels/KoinonView.js";

// ---------------------------------------------------------------------------
// The Koinon tab (koinon prompt 1) against a mocked API: what a non-member, a
// plain member, the vice and the leader each see, the take-the-lead card, the
// one read stamp for unread posts, and the hook order across the page's states.
// The Muster card (koinon prompt 3): the form, an open muster with its pledges
// and the member's own, the last muster's report, and the read at the launch.
// ---------------------------------------------------------------------------

const NOW = "2026-10-04T12:00:00.000Z";
const inHours = (h: number) => new Date(Date.parse(NOW) + h * 3_600_000).toISOString();
const rules = { foundCost: 50, foundPrestige: 20, memberCap: 8, nameMin: 3, nameMax: 32, postMaxChars: 300, cooldownHours: 24, absentLeaderDays: 5, depositMax: 10000, lescheCost: 500, lescheBuildDays: 2, lescheUpkeep: 5, lescheCap: 12, musterMinLeadMinutes: 30, musterMaxLeadHours: 24 };

const member = (playerId: string, name: string, role: KoinonRole): KoinonMember => ({
  playerId, name, houseSlug: "iason", houseName: "Iason", professionSlug: "trader", faceId: null, portrait: null, party: role === "vice" ? "dynatoi" : "none", joinedLabel: "Winter, 300 BC", role,
});

const outsider = (over: Partial<KoinonPage["me"]> = {}, invites: KoinonPage["invites"] = []): KoinonPage => ({
  now: NOW,
  rules,
  me: { playerId: "me", role: null, cooldownUntil: null, prestige: 30, drachmae: 200, ...over },
  koina: [{ id: "k1", name: "The Sacred Band", leaderName: "Kallias", members: 3, cap: 8 }],
  invites,
  koinon: null,
});

// A koinon of three: Kallias leads, Deon is vice, Nikias is a member. `as` is the viewer.
function inside(as: "kallias" | "deon" | "nikias", over: Partial<NonNullable<KoinonPage["koinon"]>> = {}): KoinonPage {
  const role: KoinonRole = as === "kallias" ? "leader" : as === "deon" ? "vice" : "member";
  return {
    now: NOW,
    rules,
    me: { playerId: as, role, cooldownUntil: null, prestige: 30, drachmae: 200 },
    koina: [
      { id: "k2", name: "Sons of Protis", leaderName: "Lykos", members: 1, cap: 8 },
      { id: "k1", name: "The Sacred Band", leaderName: "Kallias", members: 3, cap: 8 },
    ],
    invites: [],
    koinon: {
      id: "k1",
      name: "The Sacred Band",
      foundedLabel: "Winter, 300 BC",
      cap: 8,
      leaderPlayerId: "kallias",
      vicePlayerId: "deon",
      leaderAbsent: false,
      canTakeLead: false,
      members: [member("kallias", "Kallias", "leader"), member("deon", "Deon", "vice"), member("nikias", "Nikias", "member")],
      pending: role === "member" ? [] : [{ id: "i1", playerName: "Xenon", expiresAt: inHours(30) }],
      posts: [{ id: "p1", authorName: "Kallias", body: "Muster at dawn.", label: "Spring, 300 BC", canDelete: role === "leader" }],
      unread: 0,
      treasury: 120,
      hall: { phase: "none", startedAt: null, completesAt: null, paidUntil: null, daysCovered: 0 },
      givers: [
        { playerId: "kallias", name: "Kallias", total: 100 },
        { playerId: "nikias", name: "Nikias", total: 20 },
      ],
      gifts: [
        { id: "g2", name: "Nikias", amount: 20, label: "Spring, 300 BC" },
        { id: "g1", name: "Kallias", amount: 100, label: "Winter, 300 BC" },
      ],
      muster: null,
      lastMuster: null,
      ...over,
    },
  };
}
type Hall = NonNullable<KoinonPage["koinon"]>["hall"];
const hall = (phase: Hall["phase"], over: Partial<Hall> = {}): Hall => ({ phase, startedAt: inHours(-24), completesAt: inHours(24), paidUntil: inHours(24), daysCovered: 0, ...over });

const unit = (unitId: string, label: string, count: number) => ({ unitId, label, plural: `${label}s`, icon: `${label.toUpperCase()}.webp`, source: "trained" as const, count });
const armies: KoinonArmies = {
  now: NOW,
  members: [
    { playerId: "kallias", name: "Kallias", levy: 120, fleet: { pentekonters: 0, triremes: 0 }, home: [], away: [], training: [] },
    {
      playerId: "nikias",
      name: "Nikias",
      levy: 80,
      fleet: { pentekonters: 2, triremes: 1 },
      home: [{ placeId: "R060", placeName: "Massalia", rows: [unit("hoplite", "Hoplite", 15)] }],
      away: [{ ...unit("ekdromos", "Ekdromos", 8), missionKind: "raid", targetName: "Salyes", arrivesAt: inHours(2) }],
      training: [{ ...unit("peltast", "Peltast", 7), readyAt: inHours(5) }],
    },
  ],
};

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const buttons = (el: ParentNode) => [...el.querySelectorAll("button")].map((b) => b.textContent);
const button = (el: ParentNode, text: string) => [...el.querySelectorAll("button")].find((b) => b.textContent === text) as HTMLButtonElement | undefined;
const section = (c: HTMLElement, name: string) => c.querySelector<HTMLElement>(`[data-koinon="${name}"]`);
// The Lesche's block inside the Treasury panel.
const lesche = (c: HTMLElement) => c.querySelector<HTMLElement>('[data-koinon="treasury"] [data-lesche]');
// The inline invite at the bottom of the Members panel (leader and vice).
const invite = (c: HTMLElement) => c.querySelector<HTMLElement>('[data-koinon="members"] [data-members="invite"]');
// A hero stat's value, by its key; null when the stat is not shown.
const stat = (c: HTMLElement, name: string) => c.querySelector(`.koinon-hero [data-stat="${name}"] .koinon-stat-value`)?.textContent ?? null;
const props = { player: {} as Parameters<typeof KoinonView>[0]["player"] };

// The muster's two reads, as the server answers them (targets in name order).
// From Massalia: a town three seas off and a land region; from Arelate: one
// land region.
const targetsFrom = (gatherId: string, over: Partial<KoinonMusterTargets> = {}): KoinonMusterTargets => ({
  now: NOW,
  winter: null,
  gathers: [{ id: "R060", name: "Massalia" }, { id: "arelate", name: "Arelate" }],
  gatherId,
  targets:
    gatherId === "R060"
      ? [{ regionId: "R031", townId: "reii", name: "Reii", kind: "town", route: "sea", steps: 3 }, { regionId: "R046", townId: null, name: "Salyes", kind: "region", route: "land", steps: 1 }]
      : [{ regionId: "R050", townId: null, name: "Volcae", kind: "region", route: "land", steps: 1 }],
  ...over,
});
const mineOf = (over: Partial<KoinonMusterMine> = {}): KoinonMusterMine => ({ now: NOW, gather: { id: "R060", name: "Massalia" }, rows: [], ships: [], ...over });
const musterOf = (over: Partial<KoinonMuster> = {}): KoinonMuster => ({
  id: "m1",
  kind: "raid",
  openerName: "Deon",
  canCancel: false,
  target: { regionId: "R031", townId: "reii", name: "Reii" },
  gather: { id: "R060", name: "Massalia" },
  openedLabel: "Summer, 300 BC",
  launchAt: inHours(2),
  pledges: [],
  outlook: { route: "sea", steps: 3, ok: false, reason: "No men under arms.", space: 0, hullSpace: 0 },
  ...over,
});

// Every test starts with the muster's reads answered: the card is on every member's page.
beforeEach(() => {
  vi.spyOn(api, "koinonMusterTargets").mockImplementation(async (gatherId) => targetsFrom(gatherId ?? "R060"));
  vi.spyOn(api, "koinonMusterMine").mockResolvedValue(mineOf());
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function mount(page: KoinonPage, onRefresh = vi.fn()) {
  vi.spyOn(api, "koinon").mockResolvedValue(page);
  const armiesCall = vi.spyOn(api, "koinonArmies").mockResolvedValue(armies);
  const read = vi.spyOn(api, "koinonRead").mockResolvedValue({ ok: true });
  const utils = render(<KoinonView {...props} onRefresh={onRefresh} />);
  await flush();
  return { ...utils, armiesCall, read, onRefresh };
}

describe("KoinonView · not in a koinon", () => {
  it("shows an invitation with Accept, Decline and the soldiers note, and accepts through the API", async () => {
    const { container, onRefresh } = await mount(outsider({}, [{ id: "i1", koinonId: "k1", koinonName: "The Sacred Band", inviterName: "Kallias", expiresAt: inHours(47.5) }]));
    const accept = vi.spyOn(api, "koinonAccept").mockResolvedValue({ ok: true });

    expect(container.querySelector(".koinon-lede")!.textContent).toBe("A koinon is a sworn company of citizens. Its leader sees the soldiers of every member.");
    const invitations = section(container, "invitations")!;
    expect(invitations.textContent).toContain("The Sacred Band · invited by Kallias · 48h left");
    expect(invitations.textContent).toContain("Accepting lets its leader see your soldiers.");
    expect(buttons(invitations)).toEqual(["Accept", "Decline"]);
    expect(section(container, "koina")!.textContent).toContain("The Sacred Band · led by Kallias · 3 of 8");

    fireEvent.click(button(invitations, "Accept")!);
    await flush();
    expect(accept).toHaveBeenCalledWith("i1");
    expect(api.koinon).toHaveBeenCalledTimes(2);
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("under cooldown Accept is disabled with the reason, and so is Found", async () => {
    const { container } = await mount(outsider({ cooldownUntil: inHours(3) }, [{ id: "i1", koinonId: "k1", koinonName: "The Sacred Band", inviterName: "Kallias", expiresAt: inHours(40) }]));
    const invitations = section(container, "invitations")!;
    expect(button(invitations, "Accept")!.disabled).toBe(true);
    expect(button(invitations, "Decline")!.disabled).toBe(false);
    expect(invitations.textContent).toContain("You left a koinon too recently. You may join another in 3h 0m.");
    expect(container.querySelector<HTMLButtonElement>('[data-action="found"]')!.disabled).toBe(true);
  });

  it("Found is disabled with the prestige reason at prestige 19, and enabled at 20", async () => {
    const { container } = await mount(outsider({ prestige: 19 }));
    const found = section(container, "found")!;
    expect(found.textContent).toContain("Needs prestige 20 and 50 drachmae.");
    const foundButton = container.querySelector<HTMLButtonElement>('[data-action="found"]')!;
    expect(foundButton.textContent).toBe("Found · 50 drachmae");
    expect(foundButton.disabled).toBe(true);
    expect(found.querySelector(".koinon-reason")!.textContent).toBe("Your prestige is 19. Founding needs 20.");
    expect(section(container, "invitations")).toBeNull();
    cleanup();

    const ready = await mount(outsider({ prestige: 20, drachmae: 50 }));
    expect(ready.container.querySelector<HTMLButtonElement>('[data-action="found"]')!.disabled).toBe(false);
    cleanup();

    const poor = await mount(outsider({ drachmae: 49 }));
    expect(section(poor.container, "found")!.querySelector(".koinon-reason")!.textContent).toBe("You hold 49 drachmae. Founding costs 50.");
  });

  it("with no koinon in the city the list says so", async () => {
    const { container } = await mount({ ...outsider(), koina: [] });
    expect(section(container, "koina")!.textContent).toContain("No koina yet.");
  });
});

describe("KoinonView · in a koinon", () => {
  it("a plain member reads the board and the members: no post form, no leader controls, no soldiers", async () => {
    const { container, armiesCall } = await mount(inside("nikias"));
    expect(section(container, "hero")!.querySelector(".koinon-hero-name")!.textContent).toBe("The Sacred Band");
    expect(section(container, "hero")!.querySelector(".koinon-facts")!.textContent).toBe("Founded Winter, 300 BC · Led by Kallias · Vice Deon");
    expect(section(container, "board")!.textContent).toContain("Kallias · Spring, 300 BC");
    expect(section(container, "board")!.textContent).toContain("Muster at dawn.");
    expect(container.querySelector("textarea")).toBeNull();
    expect(invite(container)).toBeNull();
    expect(section(container, "take-lead")).toBeNull();
    expect(armiesCall).not.toHaveBeenCalled();
    // Plain rows: no disclosure, no soldiers and no men or levy figure.
    expect(section(container, "members")!.querySelector("details, summary, .koinon-member-men, [data-soldiers]")).toBeNull();
    expect(section(container, "members")!.textContent).not.toMatch(/levy|\d+ men/);

    const rows = [...container.querySelectorAll(".koinon-member")];
    expect(rows.map((r) => r.querySelector(".koinon-row-title")!.textContent)).toEqual(["Kallias of House Iason Leader", "Deon of House Iason Vice", "Nikias of House Iason "]);
    expect(rows[1]!.querySelector(".koinon-row-sub")!.textContent).toBe("Trader · Dynatoi · Joined Winter, 300 BC");
    // A member sees the koina of the city too, his own among them, above Leave.
    const koina = section(container, "koina")!;
    expect([...koina.querySelectorAll(".koinon-row-title")].map((r) => r.textContent)).toEqual(["Sons of Protis · led by Lykos · 1 of 8", "The Sacred Band · led by Kallias · 3 of 8"]);
    const order = [...container.querySelectorAll("[data-koinon], .koinon-leave")].map((el) => el.getAttribute("data-koinon") ?? "leave");
    expect(order).toEqual(["hero", "board", "muster", "treasury", "members", "koina", "leave"]);
    // The muster's form (any member may call one), Give and Leave are all a member has.
    expect(buttons(container)).toEqual(["Massalia▾", "Salyes · by land▾", "In 30 minutes▾", "Call the muster", "Give", "Leave"]);
    expect(button(container, "Leave")!.classList.contains("danger")).toBe(true);
  });

  it("the vice has the post form and Invite with the pending list, but no soldiers", async () => {
    const { container, armiesCall } = await mount(inside("deon"));
    const board = section(container, "board")!;
    expect(board.querySelector("textarea")).not.toBeNull();
    expect(board.querySelector(".koinon-counter")!.textContent).toBe("0 / 300");
    fireEvent.change(board.querySelector("textarea")!, { target: { value: "Bring spears." } });
    expect(board.querySelector(".koinon-counter")!.textContent).toBe("13 / 300");
    expect(buttons(board)).toEqual(["Post"]);

    // The invite is inline at the bottom of the Members panel, its pending list under it.
    const inline = invite(container)!;
    expect(section(container, "members")!.lastElementChild).toBe(inline);
    expect(inline.textContent).toContain("Xenon · 30h left");
    expect(buttons(inline)).toEqual(["Invite", "Withdraw"]);
    const withdraw = vi.spyOn(api, "koinonWithdraw").mockResolvedValue({ ok: true });
    fireEvent.click(button(inline, "Withdraw")!);
    await flush();
    expect(withdraw).toHaveBeenCalledWith("i1");
    // The vice's member rows are plain: no actions, no disclosure, no figures.
    expect([...container.querySelectorAll(".koinon-member button")]).toEqual([]);
    expect(section(container, "members")!.querySelector("details, .koinon-member-men, [data-soldiers]")).toBeNull();
    expect(armiesCall).not.toHaveBeenCalled();

    // A refusal shows as it comes, in the note line.
    vi.spyOn(api, "koinonInvite").mockRejectedValue(new ApiError("That citizen is already in a koinon.", 409));
    fireEvent.change(invite(container)!.querySelector("input")!, { target: { value: "Timon" } });
    fireEvent.click(button(invite(container)!, "Invite")!);
    await flush();
    expect(api.koinonInvite).toHaveBeenCalledWith("Timon");
    expect(container.querySelector('[role="status"]')!.textContent).toBe("That citizen is already in a koinon.");
  });

  it("the leader's member rows open to that member's soldiers and the actions on him; there is no Soldiers card and no Invite card", async () => {
    const { container, armiesCall } = await mount(inside("kallias"));
    expect(armiesCall).toHaveBeenCalledTimes(1);
    expect(buttons(section(container, "board")!)).toEqual(["Post", "Delete"]);
    expect([...container.querySelectorAll("[data-koinon], .koinon-leave")].map((el) => el.getAttribute("data-koinon") ?? "leave")).toEqual(["hero", "board", "muster", "treasury", "members", "koina", "leave"]);
    expect(section(container, "soldiers")).toBeNull();
    expect(section(container, "invite")).toBeNull();
    expect(container.textContent).not.toContain("Soldiers of the koinon");

    // Every row is a disclosure, closed until opened; the summary is the row.
    const rows = [...container.querySelectorAll<HTMLDetailsElement>(".koinon-member")];
    expect(rows.map((r) => [r.tagName, r.open])).toEqual([["DETAILS", false], ["DETAILS", false], ["DETAILS", false]]);
    expect(rows.map((r) => r.querySelector("summary .koinon-row-title")!.textContent)).toEqual(["Kallias of House Iason Leader", "Deon of House Iason Vice", "Nikias of House Iason "]);
    // Men and levy at the right of the row, from the armies payload; Deon is not in it.
    expect(rows.map((r) => r.querySelector("summary .koinon-member-men")?.textContent ?? null)).toEqual(["0 men · levy 120", null, "30 men · levy 80"]);

    // His own row: his soldiers, no actions on himself.
    expect(buttons(rows[0]!)).toEqual([]);
    expect(rows[0]!.querySelector("[data-soldiers]")!.textContent).toContain("No soldiers.");
    // The vice: the three actions, with Clear vice.
    expect(buttons(rows[1]!)).toEqual(["Clear vice", "Hand over the lead", "Expel"]);
    expect(rows[1]!.querySelector("[data-soldiers]")).toBeNull();

    // Opening Nikias's row shows his soldiers and the three actions.
    const nikias = rows[2]!;
    fireEvent.click(nikias.querySelector("summary")!);
    nikias.open = true;
    const his = nikias.querySelector<HTMLElement>('[data-soldiers="nikias"]')!;
    expect(his.querySelector('[data-group="home"]')!.textContent).toBe("At homeMassaliaHoplite · 15");
    expect(his.querySelector('[data-group="away"]')!.textContent).toBe("AwayEkdromos · 8Raiding Salyes · back in 2h 0m");
    expect(his.querySelector('[data-group="training"]')!.textContent).toBe("In trainingPeltast · 7ready in 5h 0m");
    expect(his.querySelector(".koinon-fleet")!.textContent).toBe("2 pentekonters · 1 triremes");
    expect(his.querySelector<HTMLImageElement>(".koinon-glyph")!.getAttribute("src")).toContain("HOPLITE.webp");
    expect(buttons(nikias.querySelector(".koinon-member-open")!)).toEqual(["Make vice", "Hand over the lead", "Expel"]);
    expect(button(nikias, "Expel")!.classList.contains("danger")).toBe(true);

    // The leader invites inline too, with Withdraw on the pending invite.
    expect(buttons(invite(container)!)).toEqual(["Invite", "Withdraw"]);
    expect(/\p{Extended_Pictographic}/u.test(container.textContent ?? "")).toBe(false);
  });

  it("an action asks first: Expel confirms, calls the API, reloads and refreshes", async () => {
    const { container, onRefresh } = await mount(inside("kallias"));
    const expel = vi.spyOn(api, "koinonExpel").mockResolvedValue({ ok: true });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const nikias = [...container.querySelectorAll<HTMLElement>(".koinon-member")][2]!;

    fireEvent.click(button(nikias, "Expel")!);
    expect(confirm).toHaveBeenLastCalledWith("Expel Nikias? They cannot join or found another koinon for 24 hours.");
    expect(expel).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    fireEvent.click(button(nikias, "Expel")!);
    await flush();
    expect(expel).toHaveBeenCalledWith("nikias");
    expect(onRefresh).toHaveBeenCalledTimes(1);

    fireEvent.click(button(container, "Leave")!);
    expect(confirm).toHaveBeenLastCalledWith("Leave The Sacred Band? You cannot join or found another koinon for 24 hours. The lead passes to Deon.");
  });

  it("the last member's Leave says the koinon ends; a member's says nothing of the lead", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const alone = await mount(inside("kallias", { members: [member("kallias", "Kallias", "leader")], vicePlayerId: null }));
    fireEvent.click(button(alone.container, "Leave")!);
    // The last member's leave names the treasury that goes to the city.
    expect(confirm).toHaveBeenLastCalledWith("Leave The Sacred Band? You cannot join or found another koinon for 24 hours. No one is left to take it: the koinon ends, and its treasury of 120 drachmae goes to the city.");
    cleanup();

    const plain = await mount(inside("nikias"));
    fireEvent.click(button(plain.container, "Leave")!);
    expect(confirm).toHaveBeenLastCalledWith("Leave The Sacred Band? You cannot join or found another koinon for 24 hours.");
  });

  it("canTakeLead shows the card and its button", async () => {
    const { container } = await mount(inside("deon", { leaderAbsent: true, canTakeLead: true }));
    const card = section(container, "take-lead")!;
    expect(card.textContent).toContain("Kallias has not been seen for 5 days. You may take the lead.");
    const takeLead = vi.spyOn(api, "koinonTakeLead").mockResolvedValue({ ok: true });
    fireEvent.click(card.querySelector<HTMLButtonElement>('[data-action="take-lead"]')!);
    await flush();
    expect(takeLead).toHaveBeenCalledTimes(1);
  });

  it("unread above zero calls koinonRead once, then onRefresh; zero calls neither", async () => {
    const { read, onRefresh, rerender } = await mount(inside("nikias", { unread: 2 }));
    expect(read).toHaveBeenCalledTimes(1);
    expect(onRefresh).toHaveBeenCalledTimes(1);
    rerender(<KoinonView {...props} onRefresh={onRefresh} />);
    await flush();
    expect(read).toHaveBeenCalledTimes(1);
    cleanup();

    const quiet = await mount(inside("nikias"));
    expect(quiet.read).not.toHaveBeenCalled();
    expect(quiet.onRefresh).not.toHaveBeenCalled();
  });
});

describe("KoinonView · the treasury and the Lesche", () => {
  it("a member sees the Treasury card with Give, the givers and the gifts, and gives through the API", async () => {
    const { container, onRefresh } = await mount(inside("nikias"));
    const give = vi.spyOn(api, "koinonGive").mockResolvedValue({ ok: true, wallet: 170, treasury: 150 });
    const card = section(container, "treasury")!;
    expect(card.querySelector(".koinon-head-note")!.textContent).toBe("120 drachmae");
    expect(card.textContent).toContain("Members give drachmae to the koinon. Nothing comes back out: the treasury pays only for the koinon's buildings.");
    // The most recent gift sits under the give row; All gifts holds every giver's total and the recent gifts.
    expect(card.querySelector("form.koinon-give + [data-latest-gift]")!.textContent).toBe("Nikias gave 20 · Spring, 300 BC");
    const all = card.querySelector("details")!;
    expect(all.open).toBe(false);
    expect(all.querySelector("summary")!.textContent).toBe("All gifts");
    expect([...all.querySelectorAll("[data-giver]")].map((r) => r.textContent)).toEqual(["Kallias · 100", "Nikias · 20"]);
    expect([...all.querySelectorAll("[data-gift]")].map((r) => r.textContent)).toEqual(["Nikias gave 20 · Spring, 300 BC", "Kallias gave 100 · Winter, 300 BC"]);
    expect([...all.querySelectorAll(".koinon-subhead")].map((h) => h.textContent)).toEqual(["Givers", "Recent gifts"]);

    // A whole number, clamped to 1..min(depositMax, wallet): the wallet holds 200.
    const input = card.querySelector<HTMLInputElement>("input")!;
    expect(input.value).toBe("1");
    fireEvent.change(input, { target: { value: "5000" } });
    expect(input.value).toBe("200");
    fireEvent.change(input, { target: { value: "-3" } });
    expect(input.value).toBe("1");
    fireEvent.change(input, { target: { value: "30.7" } });
    expect(input.value).toBe("30");
    fireEvent.click(button(card, "Give")!);
    await flush();
    expect(give).toHaveBeenCalledWith(30);
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("with no gifts the card says so, and an empty wallet cannot give", async () => {
    const page = inside("nikias", { treasury: 0, givers: [], gifts: [] });
    const { container } = await mount({ ...page, me: { ...page.me, drachmae: 0 } });
    const card = section(container, "treasury")!;
    expect(card.textContent).toContain("No gifts yet.");
    expect(card.querySelector(".koinon-subhead")).toBeNull();
    expect(card.querySelector("details")).toBeNull();
    expect(card.querySelector("[data-latest-gift]")).toBeNull();
    expect(button(card, "Give")!.disabled).toBe(true);
  });

  it("no hall: the bar reads the way toward the Lesche; the leader's Build is in the give row, disabled with the reason while short and enabled at the cost; a member sees no Build", async () => {
    // A Lesche of 200, as in content, with 140 in the treasury.
    const at = (as: "kallias" | "deon" | "nikias", treasury: number): KoinonPage => ({ ...inside(as, { treasury }), rules: { ...rules, lescheCost: 200 } });
    const short = await mount(at("kallias", 140));
    const card = section(short.container, "treasury")!;
    expect(section(short.container, "lesche")).toBeNull();
    const block = lesche(short.container)!;
    expect(block.getAttribute("data-lesche")).toBe("none");
    expect(block.querySelector(".koinon-bar-label")!.textContent).toBe("Toward the Lesche140 / 200");
    expect(block.querySelector(".koinon-bar-count")!.textContent).toBe("140 / 200");
    const bar = block.querySelector('[role="progressbar"]')!;
    expect([bar.getAttribute("aria-valuenow"), bar.getAttribute("aria-valuemax")]).toEqual(["140", "200"]);
    expect(bar.querySelector<HTMLElement>(".koinon-bar-fill")!.style.width).toBe("70%");
    expect(block.textContent).toContain("A hall for the koinon. While it stands open the koinon holds up to 12 members. It costs 200 drachmae from the treasury, takes 2 days to build, and 5 drachmae a day to keep.");
    // One row: the amount, Give, and Build.
    expect(buttons(card.querySelector("form.koinon-give")!)).toEqual(["Give", "Build · 200"]);
    const build = card.querySelector<HTMLButtonElement>('[data-action="lesche"]')!;
    expect(build.disabled).toBe(true);
    expect(build.title).toBe("The treasury holds 140 drachmae.");
    expect(card.querySelector(".koinon-reason")!.textContent).toBe("The treasury holds 140 drachmae.");
    cleanup();

    // Past the cost the bar is full and reads the cost.
    const funded = await mount(at("kallias", 260));
    expect(lesche(funded.container)!.querySelector(".koinon-bar-count")!.textContent).toBe("200 / 200");
    expect(lesche(funded.container)!.querySelector<HTMLElement>(".koinon-bar-fill")!.style.width).toBe("100%");
    cleanup();
    const ready = await mount(at("kallias", 200));
    const go = section(ready.container, "treasury")!.querySelector<HTMLButtonElement>('[data-action="lesche"]')!;
    expect(go.disabled).toBe(false);
    expect(section(ready.container, "treasury")!.querySelector(".koinon-reason")).toBeNull();
    const order = vi.spyOn(api, "koinonBuildLesche").mockResolvedValue({ ok: true, completesAt: inHours(48), treasury: 0 });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    fireEvent.click(go);
    await flush();
    expect(confirm).toHaveBeenLastCalledWith("Build the Lesche for 200 drachmae from the treasury? It cannot be cancelled.");
    expect(order).toHaveBeenCalledTimes(1);
    cleanup();

    for (const viewer of ["deon", "nikias"] as const) {
      const plain = await mount(at(viewer, 900));
      expect(lesche(plain.container)!.textContent).toContain("A hall for the koinon.");
      expect(lesche(plain.container)!.querySelector(".koinon-bar")).not.toBeNull();
      expect(buttons(section(plain.container, "treasury")!)).toEqual(["Give"]);
      expect(section(plain.container, "treasury")!.querySelector(".koinon-reason")).toBeNull();
      cleanup();
    }
  });

  it("building shows the build bar and no Build", async () => {
    const { container } = await mount(inside("kallias", { hall: hall("building") }));
    const card = lesche(container)!;
    expect(card.getAttribute("data-lesche")).toBe("building");
    expect(card.querySelector(".build-progress")).not.toBeNull();
    expect(card.querySelector(".build-progress-head")!.textContent).toContain("Building the Lesche");
    // No way-toward bar and no Build while it is going up.
    expect(card.querySelector(".koinon-bar")).toBeNull();
    expect(buttons(section(container, "treasury")!)).toEqual(["Give"]);
    expect(stat(container, "members")).toBe("3 / 8");
  });

  it("open shows the covered-days line and the hero reads 9 / 12", async () => {
    const nine = ["kallias", "deon", "nikias", "m4", "m5", "m6", "m7", "m8", "m9"].map((id, i) => member(id, id, i === 0 ? "leader" : i === 1 ? "vice" : "member"));
    const { container } = await mount(inside("nikias", { cap: 12, members: nine, hall: hall("open", { completesAt: inHours(-48), paidUntil: inHours(12), daysCovered: 24 }) }));
    expect(lesche(container)!.textContent).toBe("Open. Up to 12 members. Upkeep 5 drachmae a day; the treasury covers 24 more days.");
    expect(stat(container, "members")).toBe("9 / 12");
    expect(section(container, "members")!.querySelector(".koinon-head-note")!.textContent).toBe("9 of 12");
    expect(lesche(container)!.querySelector(".build-progress")).toBeNull();
  });

  it("shut shows the reopen line", async () => {
    const { container } = await mount(inside("kallias", { treasury: 3, hall: hall("shut", { completesAt: inHours(-96), paidUntil: inHours(-48) }) }));
    const card = lesche(container)!;
    expect(card.textContent).toBe("Shut: the treasury could not pay its upkeep. No one new joins past 8 until it reopens. It reopens when the treasury holds 5 drachmae.");
    expect(buttons(section(container, "treasury")!)).toEqual(["Give"]);
  });

  it("keeps its hook order through none, building, open and shut", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const page = vi.spyOn(api, "koinon").mockResolvedValue(inside("kallias", { treasury: 500 }));
    vi.spyOn(api, "koinonArmies").mockResolvedValue(armies);
    vi.spyOn(api, "koinonPost").mockResolvedValue({ ok: true, postId: "p9" });
    const { container } = render(<KoinonView {...props} onRefresh={() => {}} />);
    await flush();
    expect(section(container, "treasury")!.querySelector('[data-action="lesche"]')).not.toBeNull();
    // Each action reloads the page; the same component walks the hall's phases.
    for (const [phase, sign] of [["building", ".build-progress"], ["open", ".koinon-hint"], ["shut", ".koinon-hint"]] as const) {
      page.mockResolvedValue(inside("kallias", { hall: hall(phase) }));
      fireEvent.change(container.querySelector("textarea")!, { target: { value: "Word." } });
      fireEvent.click(button(section(container, "board")!, "Post")!);
      await flush();
      expect(lesche(container)!.querySelector(sign), phase).not.toBeNull();
    }
    expect(errors).not.toHaveBeenCalled();
  });
});

// The one read when the Lesche stands, on a device whose clock runs 10 minutes
// ahead of the server. Fake timers drive the device clock; each payload carries
// the server's `now`.
describe("KoinonView · the read when the Lesche stands", () => {
  const MIN = 60_000;
  const DEVICE = Date.parse("2026-10-04T12:10:00.000Z");
  const iso = (ms: number) => new Date(ms).toISOString();
  // The server's clock when the device reads `deviceMs`.
  const server = (deviceMs: number) => deviceMs - 10 * MIN;
  const building = (serverNowMs: number, completesAtMs: number): KoinonPage => ({
    ...inside("kallias", { hall: hall("building", { startedAt: iso(completesAtMs - 48 * 60 * MIN), completesAt: iso(completesAtMs), paidUntil: iso(completesAtMs) }) }),
    now: iso(serverNowMs),
  });
  const tick = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(DEVICE);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("is armed from the payload's server clock, and re-arms only from the next payload's own now", async () => {
    // By the server the hall stands in 5 minutes. By the device clock alone it
    // stood 5 minutes ago, so a timer armed from Date.now() would fire at once.
    const completes = server(DEVICE) + 5 * MIN;
    const page = vi.spyOn(api, "koinon").mockResolvedValue(building(server(DEVICE), completes));
    vi.spyOn(api, "koinonArmies").mockResolvedValue(armies);
    const { container } = render(<KoinonView {...props} onRefresh={() => {}} />);
    await tick(0);
    expect(page).toHaveBeenCalledTimes(1);
    expect(lesche(container)!.querySelector(".build-progress")).not.toBeNull();

    await tick(2 * MIN);
    expect(page).toHaveBeenCalledTimes(1);
    await tick(3 * MIN - 1000); // 4:59 after the payload
    expect(page).toHaveBeenCalledTimes(1);

    // The read comes a second after the hall stands. This payload still says
    // building, with 30 seconds left by its own now.
    page.mockResolvedValue(building(completes - 30_000, completes));
    await tick(2000);
    expect(page).toHaveBeenCalledTimes(2);
    // Re-armed from that payload: 30 seconds and one more, and not before.
    await tick(29_000);
    expect(page).toHaveBeenCalledTimes(2);
    page.mockResolvedValue(inside("kallias", { cap: 12, hall: hall("open", { completesAt: iso(completes), paidUntil: iso(completes + 24 * 60 * MIN), daysCovered: 23 }) }));
    await tick(3000);
    expect(page).toHaveBeenCalledTimes(3);
    expect(lesche(container)!.textContent).toContain("Open. Up to 12 members.");
    // An open hall arms nothing.
    await tick(60 * MIN);
    expect(page).toHaveBeenCalledTimes(3);
  });

  it("is cleared by every new payload and by the unmount", async () => {
    const completes = server(DEVICE) + 5 * MIN;
    const page = vi.spyOn(api, "koinon").mockResolvedValue(building(server(DEVICE), completes));
    vi.spyOn(api, "koinonArmies").mockResolvedValue(armies);
    vi.spyOn(api, "koinonPost").mockResolvedValue({ ok: true, postId: "p9" });
    const view = render(<KoinonView {...props} onRefresh={() => {}} />);
    await tick(0);
    expect(page).toHaveBeenCalledTimes(1);

    // A minute on, an action reloads the page. The new payload says the hall
    // stands an hour later: the first payload's timer must not fire at 5:01.
    await tick(MIN);
    const later = completes + 60 * MIN;
    page.mockResolvedValue(building(server(DEVICE + MIN), later));
    fireEvent.change(view.container.querySelector("textarea")!, { target: { value: "Word." } });
    fireEvent.click(button(section(view.container, "board")!, "Post")!);
    await tick(0);
    expect(page).toHaveBeenCalledTimes(2);
    await tick(10 * MIN);
    expect(page).toHaveBeenCalledTimes(2);

    // Unmounted before the hall stands: no read ever comes.
    view.unmount();
    await tick(3 * 60 * MIN);
    expect(page).toHaveBeenCalledTimes(2);
  });
});

// The Muster card. Fake timers hold the device clock on the server's `now`
// (and, for the launch read, ten minutes ahead of it).
describe("KoinonView · the muster", () => {
  const MIN = 60_000;
  const tick = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
  const picker = (root: ParentNode, label: string) => root.querySelector<HTMLButtonElement>(`.choice-picker-button[aria-label="${label}"]`)!;
  const picked = (root: ParentNode, label: string) => picker(root, label).querySelector(".choice-picker-text")!.textContent;
  const options = (root: ParentNode) => [...root.querySelectorAll<HTMLElement>(".choice-picker-option")];
  const optionTexts = (root: ParentNode) => options(root).map((o) => o.querySelector(".choice-picker-text")!.textContent);
  async function choose(root: ParentNode, label: string, text: string) {
    fireEvent.click(picker(root, label));
    fireEvent.click(options(root).find((o) => o.querySelector(".choice-picker-label")!.textContent === text)!);
    await tick(0);
  }
  async function show(page: KoinonPage) {
    const read = vi.spyOn(api, "koinon").mockResolvedValue(page);
    vi.spyOn(api, "koinonArmies").mockResolvedValue(armies);
    const view = render(<KoinonView {...props} onRefresh={() => {}} />);
    await tick(0);
    return { ...view, read, card: () => section(view.container, "muster")! };
  }
  const lines = (root: ParentNode, attr: string) => [...root.querySelectorAll(`[${attr}]`)].map((el) => el.textContent);

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse(NOW));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("with no muster the form shows, the target picker fills from the gathering place chosen, and Call the muster opens it", async () => {
    const open = vi.spyOn(api, "koinonMusterOpen").mockResolvedValue({ ok: true, musterId: "m1", launchAt: inHours(2) });
    const { card, read, container } = await show(inside("nikias"));
    // Between the Board and the Treasury.
    expect([...container.querySelectorAll("[data-koinon]")].map((el) => el.getAttribute("data-koinon")).slice(1, 4)).toEqual(["board", "muster", "treasury"]);
    expect(card().textContent).toContain("Any member may call the koinon to a raid. Members bring men to the gathering place and pledge them. At the hour they march as one.");
    expect(api.koinonMusterTargets).toHaveBeenCalledWith(undefined);
    expect(api.koinonMusterMine).not.toHaveBeenCalled();
    expect(picked(card(), "gathering place")).toBe("Massalia");
    expect(picked(card(), "target of the raid")).toBe("Salyes · by land");
    expect(picked(card(), "launch of the raid")).toBe("In 30 minutes");
    fireEvent.click(picker(card(), "target of the raid"));
    expect(optionTexts(card())).toEqual(["Salyes · by land", "Reii · 3 seas"]);
    fireEvent.click(picker(card(), "target of the raid"));

    // Another gathering place: its own targets are read and the picker follows.
    await choose(card(), "gathering place", "Arelate");
    expect(api.koinonMusterTargets).toHaveBeenLastCalledWith("arelate");
    expect(picked(card(), "gathering place")).toBe("Arelate");
    expect(picked(card(), "target of the raid")).toBe("Volcae · by land");

    // The leads run from the rules' 30 minutes to their 24 hours.
    fireEvent.click(picker(card(), "launch of the raid"));
    expect(optionTexts(card())).toEqual(["In 30 minutes", "In 1 hour", "In 2 hours", "In 3 hours", "In 6 hours", "In 12 hours", "In 18 hours", "In 24 hours"]);
    fireEvent.click(options(card()).find((o) => o.textContent === "In 2 hours")!);
    fireEvent.click(button(card(), "Call the muster")!);
    await tick(0);
    expect(open).toHaveBeenCalledWith({ regionId: "R050", gatherId: "arelate", leadMinutes: 120 });
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("the targets are listed nearest first: land by steps, then sea by steps, then by name, and the form opens on the first", async () => {
    const target = (name: string, route: "land" | "sea", steps: number, townId: string | null = null) => ({ regionId: `R-${name}`, townId, name, kind: townId ? ("town" as const) : ("region" as const), route, steps });
    // As the server sends them: by name.
    const byName = [target("Abdera", "sea", 3, "abdera"), target("Albici", "land", 1), target("Emporion", "sea", 1, "emporion"), target("Reii", "sea", 3, "reii"), target("Salyes", "land", 1), target("Tauroention", "sea", 1, "tauroention")];
    vi.spyOn(api, "koinonMusterTargets").mockImplementation(async (gatherId) => targetsFrom(gatherId ?? "R060", { targets: byName }));
    const open = vi.spyOn(api, "koinonMusterOpen").mockResolvedValue({ ok: true, musterId: "m1", launchAt: inHours(1) });
    const { card } = await show(inside("nikias"));
    expect(picked(card(), "target of the raid")).toBe("Albici · by land");
    fireEvent.click(picker(card(), "target of the raid"));
    expect(optionTexts(card())).toEqual(["Albici · by land", "Salyes · by land", "Emporion · 1 sea", "Tauroention · 1 sea", "Abdera · 3 seas", "Reii · 3 seas"]);
    fireEvent.click(picker(card(), "target of the raid"));
    fireEvent.click(button(card(), "Call the muster")!);
    await tick(0);
    expect(open).toHaveBeenCalledWith({ regionId: "R-Albici", gatherId: "R060", leadMinutes: 30 });
  });

  it("the three fields sit in one row; the leader sees the men standing at the chosen gathering place, a plain member sees no note", async () => {
    // Kallias has 12 peltasts at Arelate; Nikias 15 hoplites at Massalia (and men away and in training, who do not count).
    const withArelate: KoinonArmies = { ...armies, members: [{ ...armies.members[0]!, home: [{ placeId: "arelate", placeName: "Arelate", rows: [unit("peltast", "Peltast", 12)] }] }, armies.members[1]!] };
    vi.spyOn(api, "koinon").mockResolvedValue(inside("kallias"));
    vi.spyOn(api, "koinonArmies").mockResolvedValue(withArelate);
    const leader = render(<KoinonView {...props} onRefresh={() => {}} />);
    await tick(0);
    const card = () => section(leader.container, "muster")!;
    expect([...card().querySelectorAll(".koinon-muster-fields > .koinon-muster-field .koinon-muster-label")].map((l) => l.textContent)).toEqual(["Gathering place", "Target", "Launch"]);
    const note = () => card().querySelector('[data-muster="standing"]')?.textContent ?? null;
    expect(note()).toBe("15 men stand at Massalia across members");
    expect(card().querySelector(".koinon-muster-call")!.contains(button(card(), "Call the muster")!)).toBe(true);
    await choose(card(), "gathering place", "Arelate");
    expect(note()).toBe("12 men stand at Arelate across members");
    leader.unmount();

    const plain = await show(inside("nikias"));
    expect(plain.card().querySelector('[data-muster="standing"]')).toBeNull();
    expect(plain.card().textContent).not.toContain("across members");
    plain.unmount();
    const vice = await show(inside("deon"));
    expect(vice.card().querySelector('[data-muster="standing"]')).toBeNull();
  });

  it("a town is opened by its town id; a lead that lands in Winter is greyed out and the first open one is chosen", async () => {
    const open = vi.spyOn(api, "koinonMusterOpen").mockResolvedValue({ ok: true, musterId: "m1", launchAt: inHours(1) });
    // Winter starts in an hour and lasts a day: only 30 minutes is open.
    vi.spyOn(api, "koinonMusterTargets").mockImplementation(async (gatherId) => targetsFrom(gatherId ?? "R060", { winter: { from: inHours(1), until: inHours(25) } }));
    const first = await show(inside("nikias"));
    expect(picked(first.card(), "launch of the raid")).toBe("In 30 minutes");
    fireEvent.click(picker(first.card(), "launch of the raid"));
    expect(options(first.card()).map((o) => [o.textContent, o.getAttribute("aria-disabled")])).toEqual([
      ["In 30 minutes", null], ["In 1 hour · Winter", "true"], ["In 2 hours · Winter", "true"], ["In 3 hours · Winter", "true"],
      ["In 6 hours · Winter", "true"], ["In 12 hours · Winter", "true"], ["In 18 hours · Winter", "true"], ["In 24 hours · Winter", "true"],
    ]);
    fireEvent.click(picker(first.card(), "launch of the raid"));
    await choose(first.card(), "target of the raid", "Reii");
    fireEvent.click(button(first.card(), "Call the muster")!);
    await tick(0);
    expect(open).toHaveBeenCalledWith({ townId: "reii", gatherId: "R060", leadMinutes: 30 });
    first.unmount();

    // Deep in Winter with 23 hours of it left: only the 24-hour lead reaches Spring.
    vi.spyOn(api, "koinonMusterTargets").mockImplementation(async (gatherId) => targetsFrom(gatherId ?? "R060", { winter: { from: inHours(-1), until: inHours(23) } }));
    const second = await show(inside("nikias"));
    expect(picked(second.card(), "launch of the raid")).toBe("In 24 hours");
    expect(button(second.card(), "Call the muster")!.disabled).toBe(false);
  });

  it("an open muster shows the header, the outlook in both states, the pledges and Your pledge, and pledges through the API", async () => {
    const pledge = vi.spyOn(api, "koinonMusterPledge").mockResolvedValue({ ok: true });
    const mine = vi.spyOn(api, "koinonMusterMine").mockResolvedValue(
      mineOf({
        rows: [
          { rowId: "u1", unitId: "hoplite", label: "Hoplite", plural: "Hoplites", icon: "HOPLITE.webp", source: "trained", count: 30, pledged: false },
          { rowId: "u2", unitId: "volcae-irregulars", label: "Volcae irregulars", plural: "Volcae irregulars", icon: "BAND.webp", source: "band", count: 40, pledged: false },
        ],
        ships: [
          { id: "trade-ship", label: "Pentekonter", inStock: 2, pledged: 0, range: 7, troopSpace: 20 },
          { id: "galley", label: "Trireme", inStock: 0, pledged: 0, range: 4, troopSpace: 4 },
        ],
      }),
    );
    const short = musterOf({
      pledges: [
        { playerId: "kallias", name: "Kallias", men: 30, space: 30, pentekonters: 0, triremes: 0 },
        { playerId: "deon", name: "Deon", men: 0, space: 0, pentekonters: 1, triremes: 2 },
      ],
      outlook: { route: "sea", steps: 3, ok: false, reason: "Not enough hulls: 30 space needed, 20 aboard.", space: 30, hullSpace: 20 },
    });
    const { card, read } = await show(inside("nikias", { muster: short }));

    expect(card().querySelector(".koinon-muster-head")!.textContent).toBe("Raid on Reii · gathering at Massalia · marches in 2h 0m");
    expect(card().textContent).toContain("Called by Deon");
    // It would not march as pledged: the reason, in the danger colour.
    expect(card().querySelector('[data-outlook="sea"]')!.textContent).toBe("As pledged: by sea, 3 seas, 20 of 20 seats filled.");
    expect(card().querySelector('.koinon-reason[data-outlook="reason"]')!.textContent).toBe("Not enough hulls: 30 space needed, 20 aboard.");
    expect(lines(card(), "data-pledge")).toEqual(["Kallias · 30 men · 0 pentekonters · 0 triremes", "Deon · 0 men · 1 pentekonter · 2 triremes"]);
    // The form is gone while a muster is open.
    expect(card().querySelector('[data-muster="form"]')).toBeNull();
    expect(api.koinonMusterTargets).not.toHaveBeenCalled();

    // Your pledge: each row at the gathering place and each hull type in port, with a count.
    expect(mine).toHaveBeenCalledTimes(1);
    const own = card().querySelector<HTMLElement>('[data-muster="mine"]')!;
    expect(lines(own, "data-row")).toEqual(["Hoplites · 30 at Massalia", "Volcae irregulars · 40 at Massalia · a band marches as one"]);
    expect(lines(own, "data-ship")).toEqual(["Pentekonter · 2 in port · carries 20 · sails 7 seas"]);
    expect(button(own, "Pledge")!.disabled).toBe(true);
    expect(button(own, "Withdraw my pledge")).toBeUndefined();
    fireEvent.change(own.querySelector('[data-row="u1"] input')!, { target: { value: "20" } });
    // A band goes whole: any count is all of it.
    fireEvent.change(own.querySelector('[data-row="u2"] input')!, { target: { value: "5" } });
    expect(own.querySelector<HTMLInputElement>('[data-row="u2"] input')!.value).toBe("40");
    fireEvent.change(own.querySelector('[data-ship="trade-ship"] input')!, { target: { value: "9" } });
    expect(own.querySelector<HTMLInputElement>('[data-ship="trade-ship"] input')!.value).toBe("2");

    // The reload shows it marching by sea with every seat it needs, and his rows pledged.
    read.mockResolvedValue(inside("nikias", { muster: musterOf({ pledges: [{ playerId: "nikias", name: "Nikias", men: 60, space: 60, pentekonters: 2, triremes: 0 }], outlook: { route: "sea", steps: 1, ok: true, reason: null, space: 30, hullSpace: 40 } }) }));
    mine.mockResolvedValue(
      mineOf({
        rows: [{ rowId: "u3", unitId: "hoplite", label: "Hoplite", plural: "Hoplites", icon: "HOPLITE.webp", source: "trained", count: 20, pledged: true }],
        ships: [{ id: "trade-ship", label: "Pentekonter", inStock: 2, pledged: 2, range: 7, troopSpace: 20 }],
      }),
    );
    fireEvent.click(button(own, "Pledge")!);
    await tick(0);
    expect(pledge).toHaveBeenCalledWith({ rows: [{ rowId: "u1", count: 20 }, { rowId: "u2", count: 40 }], ships: { "trade-ship": 2 } });
    expect(mine).toHaveBeenCalledTimes(2);
    expect(card().querySelector('[data-outlook="sea"]')!.textContent).toBe("As pledged: by sea, 1 sea, 30 of 40 seats filled.");
    expect(card().querySelector('[data-outlook="reason"]')).toBeNull();
    expect(lines(card(), "data-pledged")).toEqual(["20 Hoplites Pledged"]);
    expect(card().querySelector<HTMLInputElement>('[data-ship="trade-ship"] input')!.value).toBe("2");

    // Withdraw, once he has a pledge. Every reload is a new payload, as from the wire.
    read.mockImplementation(async () => inside("nikias", { muster: musterOf() }));
    const withdraw = vi.spyOn(api, "koinonMusterWithdraw").mockResolvedValue({ ok: true });
    fireEvent.click(button(card(), "Withdraw my pledge")!);
    await tick(0);
    expect(withdraw).toHaveBeenCalledTimes(1);
    expect(mine).toHaveBeenCalledTimes(3);
  });

  it("by land the outlook says so; with no pledge the list says no one has pledged", async () => {
    const { card } = await show(inside("nikias", { muster: musterOf({ target: { regionId: "R046", townId: null, name: "Salyes" }, outlook: { route: "land", steps: 1, ok: true, reason: null, space: 10, hullSpace: 0 } }) }));
    expect(card().querySelector('[data-outlook="land"]')!.textContent).toBe("As pledged: by land.");
    expect(card().querySelector('[data-outlook="sea"]')).toBeNull();
    expect(card().querySelector('[data-outlook="reason"]')).toBeNull();
    expect(card().textContent).toContain("No one has pledged yet.");
  });

  it("a member with no men at the gathering place sees the hint and can still pledge hulls", async () => {
    const pledge = vi.spyOn(api, "koinonMusterPledge").mockResolvedValue({ ok: true });
    vi.spyOn(api, "koinonMusterMine").mockResolvedValue(mineOf({ ships: [{ id: "trade-ship", label: "Pentekonter", inStock: 2, pledged: 0, range: 7, troopSpace: 20 }] }));
    const { card } = await show(inside("nikias", { muster: musterOf() }));
    const own = card().querySelector<HTMLElement>('[data-muster="mine"]')!;
    expect(own.textContent).toContain("Move men to Massalia from the Barracks or the map, then pledge them.");
    expect(own.querySelector("[data-row]")).toBeNull();
    expect(button(own, "Pledge")!.disabled).toBe(true);
    fireEvent.change(own.querySelector('[data-ship="trade-ship"] input')!, { target: { value: "1" } });
    expect(button(own, "Pledge")!.disabled).toBe(false);
    fireEvent.click(button(own, "Pledge")!);
    await tick(0);
    expect(pledge).toHaveBeenCalledWith({ ships: { "trade-ship": 1 } });
  });

  it("only the opener and the leader see Call it off, and it asks first", async () => {
    const plain = await show(inside("nikias", { muster: musterOf({ canCancel: false }) }));
    expect(button(plain.card(), "Call it off")).toBeUndefined();
    plain.unmount();

    const cancel = vi.spyOn(api, "koinonMusterCancel").mockResolvedValue({ ok: true });
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    const leader = await show(inside("kallias", { muster: musterOf({ canCancel: true }) }));
    const off = button(leader.card(), "Call it off")!;
    expect(off.className).toContain("danger");
    fireEvent.click(off);
    await tick(0);
    expect(confirm).toHaveBeenCalledWith("Call off the raid on Reii? Every pledge falls with it.");
    expect(cancel).not.toHaveBeenCalled();
    fireEvent.click(off);
    await tick(0);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(leader.read).toHaveBeenCalledTimes(2);
  });

  it("the last muster renders a won report, a stood-down reason and a called-off line", async () => {
    const last = (over: Partial<KoinonLastMuster>): KoinonLastMuster => ({ id: "m0", targetName: "Reii", gatherName: "Massalia", launchLabel: "Summer, 300 BC", status: "resolved", reason: null, report: null, ...over });
    const won = await show(
      inside("nikias", {
        lastMuster: last({
          report: {
            outcome: "won", reason: null, line: "Raided Reii: 50 men sent, 12 soldiers slain, 3 lost, 960 drachmae and 120 grain taken.", men: 50, lost: 3, killed: 12, plunder: { drachmae: 960, grain: 120 },
            parts: [
              { playerId: "kallias", name: "Kallias", men: 30, lost: 3, hulls: 0, seats: 0, shares: 30, drachmae: 288, grain: 36 },
              { playerId: "nikias", name: "Nikias", men: 20, lost: 0, hulls: 1, seats: 20, shares: 40, drachmae: 384, grain: 48 },
              { playerId: "deon", name: "Deon", men: 0, lost: 0, hulls: 2, seats: 30, shares: 30, drachmae: 288, grain: 36 },
            ],
          },
        }),
      }),
    );
    const block = won.card().querySelector<HTMLElement>("[data-muster-last]")!;
    expect(block.getAttribute("data-muster-last")).toBe("resolved");
    expect(block.textContent).toContain("Raid on Reii · Summer, 300 BC");
    expect(block.textContent).toContain("Raided Reii: 50 men sent, 12 soldiers slain, 3 lost, 960 drachmae and 120 grain taken.");
    expect(lines(block, "data-part")).toEqual([
      "Kallias · sent 30 men · lost 3 · 288 drachmae and 36 grain",
      "Nikias · sent 20 men and 1 hull · lost 0 · 384 drachmae and 48 grain",
      "Deon · sent 2 hulls · lost 0 · 288 drachmae and 36 grain",
    ]);
    // The form stays above it: another muster can be called.
    expect(won.card().querySelector('[data-muster="form"]')).not.toBeNull();
    won.unmount();

    const stood = await show(inside("nikias", { lastMuster: last({ status: "stood_down", reason: "Not enough hulls: 30 space needed, 20 aboard.", report: { outcome: "stood_down", reason: "Not enough hulls: 30 space needed, 20 aboard.", line: null, men: 0, lost: 0, killed: 0, plunder: null, parts: [] } }) }));
    expect(stood.card().querySelector("[data-muster-last]")!.textContent).toContain("Stood down: Not enough hulls: 30 space needed, 20 aboard.");
    stood.unmount();

    const off = await show(inside("nikias", { lastMuster: last({ status: "cancelled" }) }));
    expect(off.card().querySelector("[data-muster-last]")!.textContent).toContain("Called off.");
    expect(off.card().querySelector("[data-part]")).toBeNull();
  });

  it("the launch read is armed from the server clock with the device 10 minutes ahead, and cleared by a new payload", async () => {
    const DEVICE = Date.parse(NOW) + 10 * MIN;
    vi.setSystemTime(DEVICE);
    const iso = (ms: number) => new Date(ms).toISOString();
    const server = (deviceMs: number) => deviceMs - 10 * MIN;
    const openAt = (serverNowMs: number, launchMs: number): KoinonPage => ({ ...inside("deon", { muster: musterOf({ launchAt: iso(launchMs) }) }), now: iso(serverNowMs) });
    // By the server the muster marches in 5 minutes. By the device clock alone
    // it marched 5 minutes ago, so a timer armed from Date.now() would fire at once.
    const launch = server(DEVICE) + 5 * MIN;
    vi.spyOn(api, "koinonPost").mockResolvedValue({ ok: true, postId: "p9" });
    const { card, read, container, unmount } = await show(openAt(server(DEVICE), launch));
    expect(read).toHaveBeenCalledTimes(1);
    expect(card().querySelector(".koinon-muster-head")!.textContent).toBe("Raid on Reii · gathering at Massalia · marches in 5m 0s");
    await tick(4 * MIN + 59_000);
    expect(read).toHaveBeenCalledTimes(1);

    // A minute before that, an action had not happened; now one does, and its
    // payload says the launch is an hour later: the first payload's timer is gone.
    const later = launch + 60 * MIN;
    read.mockResolvedValue(openAt(server(DEVICE + 4 * MIN + 59_000), later));
    fireEvent.change(container.querySelector("textarea")!, { target: { value: "Word." } });
    fireEvent.click(button(section(container, "board")!, "Post")!);
    await tick(0);
    expect(read).toHaveBeenCalledTimes(2);
    await tick(10 * MIN);
    expect(read).toHaveBeenCalledTimes(2);

    // The read comes a second after the new launch, and finds the muster marched.
    read.mockResolvedValue(inside("deon", { lastMuster: { id: "m1", targetName: "Reii", gatherName: "Massalia", launchLabel: "Summer, 300 BC", status: "stood_down", reason: "No men under arms.", report: null } }));
    await tick(50 * MIN + 1000 - 1);
    expect(read).toHaveBeenCalledTimes(2);
    await tick(2000);
    expect(read).toHaveBeenCalledTimes(3);
    expect(card().textContent).toContain("Stood down: No men under arms.");
    // No muster open arms nothing; the unmount leaves nothing behind.
    await tick(3 * 60 * MIN);
    expect(read).toHaveBeenCalledTimes(3);
    unmount();
  });

  it("a payload past the launch that still shows the muster open reads again in a minute, not at once", async () => {
    const past: KoinonPage = { ...inside("nikias", { muster: musterOf({ launchAt: inHours(-0.01) }) }) };
    const { card, read } = await show(past);
    expect(card().querySelector(".koinon-muster-head")!.textContent).toBe("Raid on Reii · gathering at Massalia · marching");
    await tick(59_000);
    expect(read).toHaveBeenCalledTimes(1);
    await tick(1000);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("keeps its hook order from the form to an open muster to its report", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(api, "koinonPost").mockResolvedValue({ ok: true, postId: "p9" });
    const { card, read, container } = await show(inside("kallias"));
    expect(card().querySelector('[data-muster="form"]')).not.toBeNull();
    const reload = async (page: KoinonPage) => {
      read.mockResolvedValue(page);
      fireEvent.change(container.querySelector("textarea")!, { target: { value: "Word." } });
      fireEvent.click(button(section(container, "board")!, "Post")!);
      await tick(0);
    };
    await reload(inside("kallias", { muster: musterOf({ canCancel: true }) }));
    expect(card().querySelector('[data-muster="open"]')).not.toBeNull();
    expect(card().querySelector('[data-muster="mine"]')).not.toBeNull();
    await reload(inside("kallias", { lastMuster: { id: "m1", targetName: "Reii", gatherName: "Massalia", launchLabel: "Summer, 300 BC", status: "cancelled", reason: null, report: null } }));
    expect(card().querySelector('[data-muster="form"]')).not.toBeNull();
    expect(card().querySelector("[data-muster-last]")).not.toBeNull();
    await reload(inside("kallias", { muster: musterOf() }));
    expect(card().querySelector('[data-muster="open"]')).not.toBeNull();
    expect(errors.mock.calls.flat().some((arg) => /hook/i.test(String(arg)))).toBe(false);
    expect(errors).not.toHaveBeenCalled();
  });
});

describe("KoinonView · the hero strip", () => {
  const labels = (c: HTMLElement) => [...c.querySelectorAll(".koinon-hero .koinon-stat-label")].map((l) => l.textContent);

  it("the leader sees the eyebrow, the name, who leads, and four stats including the men of every member", async () => {
    const { container } = await mount(inside("kallias"));
    const hero = section(container, "hero")!;
    expect(hero.querySelector(".koinon-eyebrow")!.textContent).toBe("Koinon");
    expect(hero.querySelector("h2")!.textContent).toBe("The Sacred Band");
    expect(hero.querySelector(".koinon-facts")!.textContent).toBe("Founded Winter, 300 BC · Led by Kallias · Vice Deon");
    expect(labels(container)).toEqual(["Members", "Treasury", "Men", "Lesche"]);
    expect(stat(container, "members")).toBe("3 / 8");
    expect(stat(container, "treasury")).toBe("120 dr");
    expect(hero.querySelector('[data-stat="treasury"] .koinon-stat-value')!.classList.contains("bright")).toBe(true);
    // Nikias: 15 at home, 8 away, 7 in training; Kallias has none.
    expect(stat(container, "men")).toBe("30");
    expect(stat(container, "lesche")).toBe("Not built");
  });

  it("a plain member and the vice see three stats, with no men", async () => {
    for (const who of ["nikias", "deon"] as const) {
      const { container, armiesCall, unmount } = await mount(inside(who));
      expect(labels(container), who).toEqual(["Members", "Treasury", "Lesche"]);
      expect(stat(container, "men"), who).toBeNull();
      expect(armiesCall).not.toHaveBeenCalled();
      unmount();
    }
  });

  it("with no vice the line names the leader alone; the Lesche stat reads each of its four words", async () => {
    const lone = await mount(inside("nikias", { vicePlayerId: null }));
    expect(section(lone.container, "hero")!.querySelector(".koinon-facts")!.textContent).toBe("Founded Winter, 300 BC · Led by Kallias");
    lone.unmount();
    for (const [phase, word] of [["none", "Not built"], ["building", "Building"], ["open", "Open"], ["shut", "Shut"]] as const) {
      const { container, unmount } = await mount(inside("nikias", { hall: hall(phase) }));
      expect(stat(container, "lesche"), phase).toBe(word);
      unmount();
    }
  });
});

describe("KoinonView · the page's panels", () => {
  it("every panel is headed by its title and one thin rule; only the Muster's border is warm; the Greek-key band appears once", async () => {
    const { container } = await mount(inside("kallias"));
    const cards = [...container.querySelectorAll(".koinon-card")];
    expect(cards.map((c) => c.querySelector("[data-koinon]")!.getAttribute("data-koinon"))).toEqual(["board", "muster", "treasury", "members", "koina"]);
    for (const card of cards) {
      expect(card.querySelector(".koinon-head .koinon-title"), card.textContent ?? "").not.toBeNull();
      expect(card.querySelectorAll(".koinon-head .koinon-rule").length).toBe(1);
    }
    expect(cards.filter((c) => c.classList.contains("warm")).map((c) => c.querySelector("[data-koinon]")!.getAttribute("data-koinon"))).toEqual(["muster"]);
    expect(container.querySelectorAll(".meander").length).toBe(1);
    expect(container.querySelector(".koinon-hero > .meander")).not.toBeNull();
    // Nothing is left of the council tab's card dress.
    expect(container.querySelector(".chamber-card, .chamber-head, .chamber-rule")).toBeNull();
  });

  it("under the hero the page is two columns: the lead, the Board and the Muster on the left, the rest in the rail", async () => {
    const keys = (root: Element) => [...root.querySelectorAll("[data-koinon], .koinon-leave")].map((el) => el.getAttribute("data-koinon") ?? "leave");
    const { container, unmount } = await mount(inside("deon", { canTakeLead: true, leaderAbsent: true }));
    expect(container.querySelector(".koinon-page > .koinon-hero")).not.toBeNull();
    expect(container.querySelector(".koinon-hero + .koinon-grid")).not.toBeNull();
    expect(keys(container.querySelector(".koinon-grid > .koinon-main")!)).toEqual(["take-lead", "board", "muster"]);
    expect(keys(container.querySelector(".koinon-grid > .koinon-rail")!).slice(0, 1)).toEqual(["treasury"]);
    expect(keys(container.querySelector(".koinon-grid > .koinon-rail")!).slice(-2)).toEqual(["koina", "leave"]);
    unmount();
    // Without the lead to take, the Board comes first.
    const plain = await mount(inside("nikias"));
    expect(keys(plain.container.querySelector(".koinon-main")!)).toEqual(["board", "muster"]);
  });

  it("the Board: the message and Post on one row with the counter; a post has its author's initial, who and when, the text and a quiet Delete", async () => {
    const { container, unmount } = await mount(inside("kallias"));
    const board = section(container, "board")!;
    const form = board.querySelector(".koinon-post-form")!;
    expect([...form.children].map((el) => el.tagName)).toEqual(["TEXTAREA", "DIV"]);
    expect(form.querySelector(".koinon-post-side button")!.textContent).toBe("Post");
    expect(form.querySelector(".koinon-post-side .koinon-counter")!.textContent).toBe("0 / 300");
    const post = board.querySelector('[data-post="p1"]')!;
    expect(post.querySelector(".koinon-initial")!.textContent).toBe("K");
    expect(post.querySelector(".koinon-row-sub")!.textContent).toBe("Kallias · Spring, 300 BC");
    expect(post.querySelector(".koinon-post-body")!.textContent).toBe("Muster at dawn.");
    const del = post.querySelector("button")!;
    expect([del.textContent, del.className]).toEqual(["Delete", "koinon-link"]);
    const remove = vi.spyOn(api, "koinonPostDelete").mockResolvedValue({ ok: true });
    fireEvent.click(del);
    await flush();
    expect(remove).toHaveBeenCalledWith("p1");
    unmount();
    // A plain member reads the post and has no Delete.
    const plain = await mount(inside("nikias"));
    expect(section(plain.container, "board")!.querySelector(".koinon-initial")!.textContent).toBe("K");
    expect(section(plain.container, "board")!.querySelector("button")).toBeNull();
  });

  it("a non-member's panels take the same titles and no band", async () => {
    const { container } = await mount(outsider({}, [{ id: "i1", koinonId: "k1", koinonName: "The Sacred Band", inviterName: "Kallias", expiresAt: inHours(40) }]));
    expect([...container.querySelectorAll(".koinon-title")].map((t) => t.textContent)).toEqual(["Your invitations", "Found a koinon", "Koina of the city"]);
    expect(container.querySelector(".meander")).toBeNull();
    expect(container.querySelector(".koinon-card.warm")).toBeNull();
  });
});

describe("KoinonView · hooks and wording", () => {
  it("keeps its hook order from loading to a non-member to a leader", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const page = vi.spyOn(api, "koinon").mockResolvedValue(outsider());
    vi.spyOn(api, "koinonArmies").mockResolvedValue(armies);
    const found = vi.spyOn(api, "koinonFound").mockResolvedValue({ ok: true, koinonId: "k1", name: "The Sacred Band", wallet: 150 });
    const { container } = render(<KoinonView {...props} onRefresh={() => {}} />);
    expect(container.textContent).toBe("Reading the koinon…");
    await flush();

    // Founding reloads the page: the same component now renders the leader's view.
    page.mockResolvedValue(inside("kallias"));
    fireEvent.change(container.querySelector<HTMLInputElement>('[data-koinon="found"] input')!, { target: { value: "The Sacred Band" } });
    fireEvent.click(container.querySelector<HTMLButtonElement>('[data-action="found"]')!);
    await flush();
    expect(found).toHaveBeenCalledWith("The Sacred Band");
    expect(section(container, "members")!.querySelector("details [data-soldiers]")).not.toBeNull();
    expect(errors.mock.calls.flat().some((arg) => /hook/i.test(String(arg)))).toBe(false);
    expect(errors).not.toHaveBeenCalled();
  });

  it("an Away line uses the Barracks roster's wording for each mission kind", () => {
    expect(awayLine({ missionKind: "raid", targetName: "Salyes" })).toBe("Raiding Salyes");
    expect(awayLine({ missionKind: "scout", targetName: "Salyes" })).toBe("Scouting Salyes");
    expect(awayLine({ missionKind: "attack", targetName: "Reii" })).toBe("Marching on Reii");
    expect(awayLine({ missionKind: "move", targetName: "Reii" })).toBe("Marching to Reii");
    expect(awayLine({ missionKind: "return", targetName: "Salyes" })).toBe("Returning from Salyes");
    expect(awayLine({ missionKind: "return", targetName: null })).toBe("Returning");
  });
});
