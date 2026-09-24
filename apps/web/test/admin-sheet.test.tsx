// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The admin stats-and-inventory sheet: the four stats beside the drachmae in the
// list, and a sheet of stats, goods and household, each line adjustable like the
// wallet (relative amount + reason), with the sheet reloaded after an adjustment.
const adminUsers = vi.fn();
const adminSheet = vi.fn();
const adminAdjustStat = vi.fn();
const adminAdjustGoods = vi.fn();
const adminAdjustPops = vi.fn();

vi.mock("../src/api.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/api.js")>();
  return {
    ...actual,
    api: {
      me: () => Promise.resolve({ user: { id: "a", email: "a@t" }, hasCharacter: true, isAdmin: true }),
      adminUsers,
      adminSheet,
      adminAdjustStat,
      adminAdjustGoods,
      adminAdjustPops,
    },
  };
});

const { AdminPage } = await import("../src/AdminPage.js");

const character = { characterId: "c1", playerId: "p1", worldId: "w1", name: "Pytheas", drachmae: 500, status: "alive", isActive: true, prestige: 95, devotion: 3, militia: 0, intelligence: 7 };
const sheetOf = (prestige: number) => ({
  characterId: "c1",
  name: "Pytheas",
  drachmae: 500,
  stats: { prestige, devotion: 3, militia: 0, intelligence: 7 },
  goods: [{ type: "iron", label: "Iron", amount: 0 }, { type: "grain", label: "Wheat", amount: 4.5 }],
  pops: [{ type: "slave", label: "Slave", count: 2, max: null }, { type: "physician", label: "Physician", count: 0, max: 1 }],
});

// Cheap DOM lookups (see admin-verify.test.tsx): no role queries over the tables.
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 20)); });
const clickButton = (el: ParentNode, text: string) => fireEvent.click([...el.querySelectorAll("button")].find((b) => b.textContent === text)!);
const section = () => [...document.querySelectorAll("section")].find((s) => s.querySelector("h2")?.textContent?.includes("stats and inventory"));
const rowOf = (el: ParentNode, label: string) => [...el.querySelectorAll("tbody tr")].find((tr) => tr.querySelector("td")?.textContent === label)!;
const cells = (tr: Element) => [...tr.querySelectorAll("td")].slice(0, 2).map((td) => td.textContent);

beforeEach(() => {
  for (const fn of [adminUsers, adminSheet, adminAdjustStat, adminAdjustGoods, adminAdjustPops]) fn.mockReset();
  adminUsers.mockResolvedValue({
    users: [{ id: "u1", email: "sheet@t", createdAt: "2026-01-01T00:00:00.000Z", emailVerifiedAt: "2026-01-01T00:00:00.000Z", isAdmin: false, bannedAt: null, banReason: null, deletedAt: null, lastSeenAt: null, lastIp: null, characters: [character] }],
  });
  adminSheet.mockResolvedValueOnce(sheetOf(95)).mockResolvedValue(sheetOf(100));
  adminAdjustStat.mockResolvedValue({ ok: true, value: 100 });
  adminAdjustGoods.mockResolvedValue({ ok: true, amount: 10 });
  adminAdjustPops.mockResolvedValue({ ok: true, count: 1 });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("AdminPage stats and inventory", () => {
  it("shows the stats in the list, opens the sheet, and adjusts a stat, a good and a pop", async () => {
    render(<AdminPage />);
    await flush();
    clickButton(document, "Search");
    await flush();

    const line = document.querySelector("tbody li")!;
    expect(line.textContent).toContain("500 dr");
    expect(line.textContent).toContain("P 95 · D 3 · M 0 · I 7");

    clickButton(line, "Stats & inventory");
    await flush();
    expect(adminSheet).toHaveBeenCalledWith("c1");
    const open = section()!;
    expect(cells(rowOf(open, "Prestige"))).toEqual(["Prestige", "95 / 100"]);
    expect(cells(rowOf(open, "Drachmae"))).toEqual(["Drachmae", "500"]);
    expect(cells(rowOf(open, "Wheat"))).toEqual(["Wheat", "4 (4.50)"]);
    expect(cells(rowOf(open, "Physician"))).toEqual(["Physician", "0 (max 1)"]);

    vi.spyOn(window, "confirm").mockReturnValue(true);
    const prompt = vi.spyOn(window, "prompt");

    prompt.mockReturnValueOnce("5").mockReturnValueOnce("event bug");
    clickButton(rowOf(open, "Prestige"), "Adjust");
    await flush();
    expect(adminAdjustStat).toHaveBeenCalledWith("c1", "prestige", 5, "event bug");
    // The sheet reloads after the adjustment, and the outcome stays in the status line.
    expect(adminSheet).toHaveBeenCalledTimes(2);
    expect(cells(rowOf(section()!, "Prestige"))).toEqual(["Prestige", "100 / 100"]);
    expect(document.querySelector('[role="status"]')!.textContent).toBe("Prestige adjusted for Pytheas.");

    prompt.mockReturnValueOnce("10").mockReturnValueOnce("lost cargo");
    clickButton(rowOf(section()!, "Iron"), "Adjust");
    await flush();
    expect(adminAdjustGoods).toHaveBeenCalledWith("c1", "iron", 10, "lost cargo");

    prompt.mockReturnValueOnce("1").mockReturnValueOnce("support");
    clickButton(rowOf(section()!, "Physician"), "Adjust");
    await flush();
    expect(adminAdjustPops).toHaveBeenCalledWith("c1", "physician", 1, "support");

    // A cancelled reason sends nothing.
    prompt.mockReturnValueOnce("-1").mockReturnValueOnce(null);
    clickButton(rowOf(section()!, "Slave"), "Adjust");
    await flush();
    expect(adminAdjustPops).toHaveBeenCalledTimes(1);

    clickButton(section()!, "Close");
    expect(section()).toBeUndefined();
  });
});
