// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, type KoinonArmies, type KoinonMember, type KoinonPage, type KoinonRole } from "../src/api.js";
import { awayLine, KoinonView } from "../src/dashboard/panels/KoinonView.js";

// ---------------------------------------------------------------------------
// The Koinon tab (koinon prompt 1) against a mocked API: what a non-member, a
// plain member, the vice and the leader each see, the take-the-lead card, the
// one read stamp for unread posts, and the hook order across the page's states.
// ---------------------------------------------------------------------------

const NOW = "2026-10-04T12:00:00.000Z";
const inHours = (h: number) => new Date(Date.parse(NOW) + h * 3_600_000).toISOString();
const rules = { foundCost: 50, foundPrestige: 20, memberCap: 8, nameMin: 3, nameMax: 32, postMaxChars: 300, cooldownHours: 24, absentLeaderDays: 5, depositMax: 10000, lescheCost: 500, lescheBuildDays: 2, lescheUpkeep: 5, lescheCap: 12 };

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
const props = { player: {} as Parameters<typeof KoinonView>[0]["player"] };

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
    expect(section(container, "header")!.textContent).toContain("The Sacred Band");
    expect(section(container, "header")!.textContent).toContain("Founded Winter, 300 BC · Leader Kallias · Vice Deon");
    expect(section(container, "board")!.textContent).toContain("Kallias · Spring, 300 BC");
    expect(section(container, "board")!.textContent).toContain("Muster at dawn.");
    expect(container.querySelector("textarea")).toBeNull();
    expect(section(container, "invite")).toBeNull();
    expect(section(container, "soldiers")).toBeNull();
    expect(section(container, "take-lead")).toBeNull();
    expect(armiesCall).not.toHaveBeenCalled();

    const rows = [...container.querySelectorAll(".koinon-member")];
    expect(rows.map((r) => r.querySelector(".koinon-row-title")!.textContent)).toEqual(["Kallias of House Iason Leader", "Deon of House Iason Vice", "Nikias of House Iason "]);
    expect(rows[1]!.querySelector(".koinon-row-sub")!.textContent).toBe("Trader · Dynatoi · Joined Winter, 300 BC");
    // A member sees the koina of the city too, his own among them, above Leave.
    const koina = section(container, "koina")!;
    expect([...koina.querySelectorAll(".koinon-row-title")].map((r) => r.textContent)).toEqual(["Sons of Protis · led by Lykos · 1 of 8", "The Sacred Band · led by Kallias · 3 of 8"]);
    const order = [...container.querySelectorAll("[data-koinon], .koinon-leave")].map((el) => el.getAttribute("data-koinon") ?? "leave");
    expect(order).toEqual(["header", "board", "treasury", "lesche", "members", "koina", "leave"]);
    // Give and Leave are the only buttons a member has.
    expect(buttons(container)).toEqual(["Give", "Leave"]);
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

    const invite = section(container, "invite")!;
    expect(invite.textContent).toContain("Xenon · 30h left");
    expect(buttons(invite)).toEqual(["Invite", "Withdraw"]);
    expect([...container.querySelectorAll(".koinon-member button")]).toEqual([]);
    expect(section(container, "soldiers")).toBeNull();
    expect(armiesCall).not.toHaveBeenCalled();

    // A refusal shows as it comes, in the note line.
    vi.spyOn(api, "koinonInvite").mockRejectedValue(new ApiError("That citizen is already in a koinon.", 409));
    fireEvent.change(invite.querySelector("input")!, { target: { value: "Timon" } });
    fireEvent.click(button(invite, "Invite")!);
    await flush();
    expect(api.koinonInvite).toHaveBeenCalledWith("Timon");
    expect(container.querySelector('[role="status"]')!.textContent).toBe("That citizen is already in a koinon.");
  });

  it("the leader has the controls on every other member and the soldiers of the koinon", async () => {
    const { container, armiesCall } = await mount(inside("kallias"));
    expect(armiesCall).toHaveBeenCalledTimes(1);

    const rows = [...container.querySelectorAll<HTMLElement>(".koinon-member")];
    expect(buttons(rows[0]!)).toEqual([]);
    expect(buttons(rows[1]!)).toEqual(["Clear vice", "Hand over the lead", "Expel"]);
    expect(buttons(rows[2]!)).toEqual(["Make vice", "Hand over the lead", "Expel"]);
    expect(button(rows[2]!, "Expel")!.classList.contains("danger")).toBe(true);
    expect(buttons(section(container, "board")!)).toEqual(["Post", "Delete"]);

    // The leader's layout ends the same way: soldiers, the koina of the city, Leave.
    expect([...container.querySelectorAll("[data-koinon], .koinon-leave")].map((el) => el.getAttribute("data-koinon") ?? "leave")).toEqual(["header", "board", "treasury", "lesche", "members", "invite", "soldiers", "koina", "leave"]);
    const soldiers = section(container, "soldiers")!;
    const summaries = [...soldiers.querySelectorAll("summary")].map((s) => s.textContent);
    expect(summaries).toEqual(["Kallias · 0 men · levy 120", "Nikias · 30 men · levy 80"]);
    const [mine, his] = [...soldiers.querySelectorAll<HTMLElement>(".koinon-army")];
    expect(mine!.textContent).toContain("No soldiers.");
    expect(his!.querySelector('[data-group="home"]')!.textContent).toBe("At homeMassaliaHoplite · 15");
    expect(his!.querySelector('[data-group="away"]')!.textContent).toBe("AwayEkdromos · 8Raiding Salyes · back in 2h 0m");
    expect(his!.querySelector('[data-group="training"]')!.textContent).toBe("In trainingPeltast · 7ready in 5h 0m");
    expect(his!.querySelector(".koinon-fleet")!.textContent).toBe("2 pentekonters · 1 triremes");
    expect(his!.querySelector<HTMLImageElement>(".koinon-glyph")!.getAttribute("src")).toContain("HOPLITE.webp");
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
    expect([...card.querySelectorAll("[data-giver]")].map((r) => r.textContent)).toEqual(["Kallias · 100", "Nikias · 20"]);
    expect([...card.querySelectorAll("[data-gift]")].map((r) => r.textContent)).toEqual(["Nikias gave 20 · Spring, 300 BC", "Kallias gave 100 · Winter, 300 BC"]);
    expect([...card.querySelectorAll(".koinon-subhead")].map((h) => h.textContent)).toEqual(["Givers", "Recent gifts"]);

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
    expect(button(card, "Give")!.disabled).toBe(true);
  });

  it("no hall: the leader's Build is disabled with the reason at 499 and enabled at 500; a member sees no Build", async () => {
    const short = await mount(inside("kallias", { treasury: 499 }));
    const card = section(short.container, "lesche")!;
    expect(card.textContent).toContain("A hall for the koinon. While it stands open the koinon holds up to 12 members. It costs 500 drachmae from the treasury, takes 2 days to build, and 5 drachmae a day to keep.");
    const build = card.querySelector<HTMLButtonElement>('[data-action="lesche"]')!;
    expect(build.textContent).toBe("Build the Lesche · 500");
    expect(build.disabled).toBe(true);
    expect(card.querySelector(".koinon-reason")!.textContent).toBe("The treasury holds 499 drachmae.");
    cleanup();

    const funded = await mount(inside("kallias", { treasury: 500 }));
    const ready = section(funded.container, "lesche")!.querySelector<HTMLButtonElement>('[data-action="lesche"]')!;
    expect(ready.disabled).toBe(false);
    expect(section(funded.container, "lesche")!.querySelector(".koinon-reason")).toBeNull();
    const order = vi.spyOn(api, "koinonBuildLesche").mockResolvedValue({ ok: true, completesAt: inHours(48), treasury: 0 });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    fireEvent.click(ready);
    await flush();
    expect(confirm).toHaveBeenLastCalledWith("Build the Lesche for 500 drachmae from the treasury? It cannot be cancelled.");
    expect(order).toHaveBeenCalledTimes(1);
    cleanup();

    for (const viewer of ["deon", "nikias"] as const) {
      const plain = await mount(inside(viewer, { treasury: 900 }));
      const text = section(plain.container, "lesche")!;
      expect(text.textContent).toContain("A hall for the koinon.");
      expect(text.querySelector("button")).toBeNull();
      cleanup();
    }
  });

  it("building shows the build bar and no Build", async () => {
    const { container } = await mount(inside("kallias", { hall: hall("building") }));
    const card = section(container, "lesche")!;
    expect(card.querySelector(".build-progress")).not.toBeNull();
    expect(card.querySelector(".build-progress-head")!.textContent).toContain("Building the Lesche");
    expect(card.querySelector("button")).toBeNull();
    expect(section(container, "header")!.querySelector(".koinon-head-note")!.textContent).toBe("3 of 8");
  });

  it("open shows the covered-days line and the header reads 9 of 12", async () => {
    const nine = ["kallias", "deon", "nikias", "m4", "m5", "m6", "m7", "m8", "m9"].map((id, i) => member(id, id, i === 0 ? "leader" : i === 1 ? "vice" : "member"));
    const { container } = await mount(inside("nikias", { cap: 12, members: nine, hall: hall("open", { completesAt: inHours(-48), paidUntil: inHours(12), daysCovered: 24 }) }));
    expect(section(container, "lesche")!.textContent).toContain("Open. Up to 12 members. Upkeep 5 drachmae a day; the treasury covers 24 more days.");
    expect(section(container, "header")!.querySelector(".koinon-head-note")!.textContent).toBe("9 of 12");
    expect(section(container, "members")!.querySelector(".koinon-head-note")!.textContent).toBe("9 of 12");
    expect(section(container, "lesche")!.querySelector(".build-progress")).toBeNull();
  });

  it("shut shows the reopen line", async () => {
    const { container } = await mount(inside("kallias", { treasury: 3, hall: hall("shut", { completesAt: inHours(-96), paidUntil: inHours(-48) }) }));
    const card = section(container, "lesche")!;
    expect(card.textContent).toContain("Shut: the treasury could not pay its upkeep. No one new joins past 8 until it reopens. It reopens when the treasury holds 5 drachmae.");
    expect(card.querySelector("button")).toBeNull();
  });

  it("keeps its hook order through none, building, open and shut", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const page = vi.spyOn(api, "koinon").mockResolvedValue(inside("kallias", { treasury: 500 }));
    vi.spyOn(api, "koinonArmies").mockResolvedValue(armies);
    vi.spyOn(api, "koinonPost").mockResolvedValue({ ok: true, postId: "p9" });
    const { container } = render(<KoinonView {...props} onRefresh={() => {}} />);
    await flush();
    expect(section(container, "lesche")!.querySelector('[data-action="lesche"]')).not.toBeNull();
    // Each action reloads the page; the same component walks the hall's phases.
    for (const [phase, sign] of [["building", ".build-progress"], ["open", ".koinon-hint"], ["shut", ".koinon-hint"]] as const) {
      page.mockResolvedValue(inside("kallias", { hall: hall(phase) }));
      fireEvent.change(container.querySelector("textarea")!, { target: { value: "Word." } });
      fireEvent.click(button(section(container, "board")!, "Post")!);
      await flush();
      expect(section(container, "lesche")!.querySelector(sign), phase).not.toBeNull();
    }
    expect(errors).not.toHaveBeenCalled();
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
    expect(section(container, "soldiers")).not.toBeNull();
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
