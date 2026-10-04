// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The admin Koina section (koinon prompt 1): the active world's live koina with
// Rename and Dissolve, each asking for a reason before it calls the API.
const adminUsers = vi.fn();
const adminKoina = vi.fn();
const adminKoinonRename = vi.fn();
const adminKoinonDissolve = vi.fn();

vi.mock("../src/api.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/api.js")>();
  return {
    ...actual,
    api: { me: () => Promise.resolve({ user: { id: "a", email: "a@t" }, hasCharacter: true, isAdmin: true }), adminUsers, adminKoina, adminKoinonRename, adminKoinonDissolve },
  };
});

const { AdminPage } = await import("../src/AdminPage.js");

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 20)); });
const clickButton = (el: ParentNode, text: string) => fireEvent.click([...el.querySelectorAll("button")].find((b) => b.textContent === text)!);
const section = () => document.querySelector<HTMLElement>('[data-admin="koina"]')!;
const rowOf = (name: string) => [...section().querySelectorAll("tbody tr")].find((tr) => tr.textContent?.includes(name))!;
const cells = (tr: Element) => [...tr.querySelectorAll("td")].slice(0, 4).map((td) => td.textContent);

beforeEach(() => {
  for (const mock of [adminUsers, adminKoina, adminKoinonRename, adminKoinonDissolve]) mock.mockReset();
  adminUsers.mockResolvedValue({ users: [] });
  adminKoina.mockResolvedValue({
    koina: [
      { id: "k1", name: "The Sacred Band", leaderName: "Kallias", members: 3, foundedAt: "2026-10-01T09:30:00.000Z" },
      { id: "k2", name: "The Elders", leaderName: "Deon", members: 1, foundedAt: "2026-10-02T18:00:00.000Z" },
    ],
  });
  adminKoinonRename.mockResolvedValue({ ok: true, name: "The Holy Band" });
  adminKoinonDissolve.mockResolvedValue({ ok: true, name: "The Sacred Band", members: 3 });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("AdminPage koina", () => {
  it("lists the koina on Load koina, and Dissolve calls the API with the reason", async () => {
    render(<AdminPage />);
    await flush();
    expect(section().querySelector("table")).toBeNull();
    clickButton(section(), "Load koina");
    await flush();
    expect(cells(rowOf("The Sacred Band"))).toEqual(["The Sacred Band", "Kallias", "3", "2026-10-01 09:30"]);
    expect(cells(rowOf("The Elders"))).toEqual(["The Elders", "Deon", "1", "2026-10-02 18:00"]);

    // No reason, no call.
    const prompt = vi.spyOn(window, "prompt").mockReturnValue("");
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    clickButton(rowOf("The Sacred Band"), "Dissolve");
    await flush();
    expect(adminKoinonDissolve).not.toHaveBeenCalled();

    prompt.mockReturnValue("abandoned");
    clickButton(rowOf("The Sacred Band"), "Dissolve");
    await flush();
    expect(confirm).toHaveBeenLastCalledWith("Dissolve the koinon The Sacred Band? Its 3 member(s) are removed, with no cooldown.");
    expect(adminKoinonDissolve).toHaveBeenCalledWith("k1", "abandoned");
    expect(adminKoina).toHaveBeenCalledTimes(2); // the list is read again after the action
    expect(document.querySelector('[role="status"]')!.textContent).toBe("Dissolved the koinon The Sacred Band.");
  });

  it("Rename asks for the new name, then the reason, and calls the API with both", async () => {
    render(<AdminPage />);
    await flush();
    clickButton(section(), "Load koina");
    await flush();

    vi.spyOn(window, "prompt").mockReturnValueOnce("The Holy Band").mockReturnValueOnce("offensive name");
    vi.spyOn(window, "confirm").mockReturnValue(true);
    clickButton(rowOf("The Sacred Band"), "Rename");
    await flush();
    expect(adminKoinonRename).toHaveBeenCalledWith("k1", "The Holy Band", "offensive name");
    expect(document.querySelector('[role="status"]')!.textContent).toBe("Renamed the koinon to The Holy Band.");
  });
});
