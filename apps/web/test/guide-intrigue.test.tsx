// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { assassinateSuccessChance, bodyguardDefense, parseInteractionsConfig, poisonSuccessChance } from "@massalia/shared";
import GuideSheet from "../src/dashboard/GuideSheet.js";
import { GUIDE_SECTIONS, type GuideBlock, type GuideTable } from "../src/dashboard/guideContent.js";
import { GuidesPage } from "../src/lobby/GuidesPage.js";

// ---------------------------------------------------------------------------
// The Guide's "Poison & Assassination" entry (hostile actions prompt 1): a plain
// reference entry with lists and tables. Every number in it is the content's
// (content/politics/interactions.json, and the poisoned trait), and its example
// rows are worked from that content. So the test reads the content and works
// each line and each row again with the shared rules: it goes red when the
// content moves and the words do not.
// ---------------------------------------------------------------------------

afterEach(cleanup);

const repo = (file: string) => JSON.parse(readFileSync(resolve(process.cwd(), "../..", file), "utf8")) as unknown;
const cfg = parseInteractionsConfig(repo("content/politics/interactions.json"));
const { poison, assassinate } = cfg.actions;
const poisoned = (repo("content/traits/traits.json") as { id: string; statMod?: Record<string, number> }[]).find((t) => t.id === "poisoned")!.statMod!;
const vendor = (repo("content/buildings/buildings.json") as { vendor: Record<string, unknown> }).vendor;
const pops = (repo("content/people/pops.json") as { pops: Record<string, { max?: number }> }).pops;

const entry = () => GUIDE_SECTIONS.find((s) => s.id === "intrigue")!;
const blocks = (): GuideBlock[] => entry().blocks!;
const lines = () => blocks().flatMap((b) => (b.kind === "list" ? b.items : b.kind === "text" ? [b.text] : []));
const table = (caption: string): GuideTable => blocks().flatMap((b) => (b.kind === "table" ? [b.table] : [])).find((t) => t.caption === caption)!;
const row = (caption: string, head: string) => table(caption).rows.find((r) => r[0] === head)!;
const pct = (p: number) => `${Math.round(p * 100)}%`;

// The examples' attacker, and the targets as the rows describe them.
const ATTACKER = 60;
const POISON_EXAMPLES = [
  { label: "Intelligence 35", intelligence: 35, physician: false, guard: false },
  { label: "Intelligence 35, physician", intelligence: 35, physician: true, guard: false },
  { label: "Intelligence 35, physician, spymaster on Guard", intelligence: 35, physician: true, guard: true },
  { label: "Intelligence 55, physician, spymaster on Guard", intelligence: 55, physician: true, guard: true },
];
const BLADE_EXAMPLES = [
  { label: "Intelligence 30, Militia 0", intelligence: 30, militia: 0, bodyguards: 0, guard: false },
  { label: "Intelligence 30, Militia 0, two bodyguards", intelligence: 30, militia: 0, bodyguards: 2, guard: false },
  { label: "Intelligence 30, Militia 0, two bodyguards, spymaster on Guard", intelligence: 30, militia: 0, bodyguards: 2, guard: true },
  { label: "Intelligence 30, Militia 40", intelligence: 30, militia: 40, bodyguards: 0, guard: false },
  { label: "Intelligence 30, Militia 80", intelligence: 30, militia: 80, bodyguards: 0, guard: false },
  { label: "Intelligence 30, Militia 100", intelligence: 30, militia: 100, bodyguards: 0, guard: false },
];

describe("the Guide's Poison & Assassination entry", () => {
  it("is the Guide's last entry: one opening line, four headings, four tables", () => {
    expect(GUIDE_SECTIONS.map((s) => s.id)).toEqual(["calendar", "holdings", "family", "politics", "war", "intrigue"]);
    expect(entry().title).toBe("Poison & Assassination");
    expect(entry().paragraphs).toHaveLength(1);
    expect(blocks().flatMap((b) => (b.kind === "heading" ? [b.text] : []))).toEqual(["Who can strike, and at whom", "The chance of success", "Examples", "Afterwards"]);
    expect(blocks().flatMap((b) => (b.kind === "table" ? [b.table.caption] : []))).toEqual(["The two actions", "What counts as defense", "Poison", "Assassination"]);
    // Every row is as wide as its table's head.
    for (const b of blocks()) if (b.kind === "table") for (const r of b.table.rows) expect(r).toHaveLength(b.table.columns.length);
  });

  it("states who may strike and what each action costs, as the content has it", () => {
    // The lock under the button is the server's own line (interactions.ts, POISON_NO_STANDING).
    expect(lines()).toContain(`The target must be alive and have at least ${cfg.prestigeFloor} prestige. Below that the action is locked: "Target lacks standing."`);
    expect(row("The two actions", "Cost")).toEqual(["Cost", "1 vial of poison", `${assassinate.costDrachmae} drachmae`]);
    const ill = poison.illnessChance * 10;
    expect(row("The two actions", "If it succeeds")[1]).toBe(`The target falls ill (${ill} in 10) or dies (${10 - ill} in 10)`);
  });

  it("states the chance as the content has it: the two starts, the step a point, the floor and the cap, the hunt", () => {
    expect(lines()).toContain(`Poison starts at ${pct(poison.baseChance)}. Assassination starts at ${pct(assassinate.baseChance)}.`);
    // One step a point and one floor and cap for both actions, as the entry says them once.
    expect(assassinate.statScale).toBe(poison.statScale);
    expect([assassinate.clampMin, assassinate.clampMax]).toEqual([poison.clampMin, poison.clampMax]);
    const step = 100 / poison.statScale;
    expect(lines()).toContain(`Each point of your Intelligence above the target's defense adds ${step}%. Each point below takes ${step}% away.`);
    expect(lines()).toContain(`The chance is never below ${pct(poison.clampMin)} and never above ${pct(poison.clampMax)}.`);
    expect(lines()).toContain(`A spymaster set to Hunt adds ${cfg.spymaster.huntMod} to your Intelligence for your own attempts.`);
    // One posture switch a day.
    expect(cfg.spymaster.postureCooldownHours).toBe(24);
    expect(lines()).toContain("A spymaster holds one posture at a time, Guard or Hunt, and can change it once a day.");
    expect(lines()).toContain(
      "You are never shown the chance. The standings rank citizens by Intelligence and Militia but show no numbers, and no one can see another citizen's physician, bodyguards or spymaster.",
    );
  });

  it("states what defends, as the content has it: militia at half against the blade only, the physician, the bodyguards, the guard", () => {
    expect(assassinate.militiaDefenseWeight).toBe(0.5);
    expect(row("What counts as defense", "Militia")).toEqual(["Militia", "Nothing", "Half a point per point"]);
    expect(row("What counts as defense", "Physician")).toEqual(["Physician", `+${poison.physicianMod}`, "Nothing"]);
    const guards = [1, 2, 3].map((n) => bodyguardDefense(n, assassinate));
    // Bodyguards have no hiring limit, so the entry states the curve's cap: bodyguardModMax.
    expect(assassinate.bodyguardModMax).toBe(24);
    expect(bodyguardDefense(1000, assassinate)).toBeLessThanOrEqual(assassinate.bodyguardModMax);
    expect(row("What counts as defense", "Bodyguards")).toEqual([
      "Bodyguards",
      "Nothing",
      `+${guards[0]} with one, +${guards[1]} with two, +${guards[2]} with three, never above +${assassinate.bodyguardModMax}`,
    ]);
    expect(row("What counts as defense", "Spymaster set to Guard")).toEqual(["Spymaster set to Guard", `+${cfg.spymaster.guardMod}`, `+${cfg.spymaster.guardMod}`]);
  });

  it("states where each thing comes from, as the content has it: two vendor goods, three kinds of people, one physician, one spymaster, bodyguards without limit", () => {
    expect(Object.keys(vendor)).toEqual(expect.arrayContaining(["poison", "remedy"]));
    expect(Object.keys(pops)).toEqual(expect.arrayContaining(["physician", "bodyguard", "spymaster"]));
    expect([pops.physician!.max, pops.spymaster!.max, pops.bodyguard!.max]).toEqual([1, 1, undefined]);
    expect(lines()).toContain(
      "Poison and remedies are goods, bought at the Market. Physicians, bodyguards and spymasters are hired there, under People: one physician and one spymaster at most, bodyguards without limit.",
    );
  });

  it("works every poison example from the content", () => {
    expect(lines()).toContain(`In every example the attacker has Intelligence ${ATTACKER} and no spymaster.`);
    expect(table("Poison").rows).toEqual(
      POISON_EXAMPLES.map((t) => {
        const guard = t.guard ? cfg.spymaster.guardMod : 0;
        const defense = t.intelligence + (t.physician ? poison.physicianMod : 0) + guard;
        const chance = poisonSuccessChance(ATTACKER, t.intelligence, t.physician, guard, poison);
        return [t.label, String(defense), pct(chance), pct(chance * poison.illnessChance), pct(chance * (1 - poison.illnessChance))];
      }),
    );
  });

  it("works every assassination example from the content", () => {
    expect(table("Assassination").rows).toEqual(
      BLADE_EXAMPLES.map((t) => {
        const guard = t.guard ? cfg.spymaster.guardMod : 0;
        const defense = t.intelligence + t.militia * assassinate.militiaDefenseWeight + bodyguardDefense(t.bodyguards, assassinate) + guard;
        return [t.label, String(defense), pct(assassinateSuccessChance(ATTACKER, t.intelligence, t.militia, t.bodyguards, guard, assassinate))];
      }),
    );
  });

  it("states what follows: the illness as the trait has it, what the chronicle keeps, and a year's guard against every hand", () => {
    const minus = (stat: string) => `−${Math.abs(poisoned[stat]!)}`;
    expect(lines()).toContain(
      `Illness: Militia ${minus("militia")}, Intelligence ${minus("intelligence")} and Prestige ${minus("prestige")}. It does not pass on its own. The cure needs a physician in your household and spends one remedy.`,
    );
    expect(lines()).toContain("Death: the house passes to the heir. The death is recorded as a poisoning or a murder, without a name.");
    expect(lines()).toContain("The target's chronicle records an illness, a cure and a failed blade, each without a name. A failed poisoning leaves no trace.");
    // One year is four seasons, and a season is a real day.
    expect(cfg.hostileCooldownHours / 24).toBe(4);
    expect(lines()).toContain(
      "The guard: after any attempt, successful or not, nobody can use poison or assassination on that citizen for one year (four days). A refused attempt costs nothing.",
    );
    expect(lines()).toContain("The one who struck sees the guard on the target's profile. Everyone else finds out only by trying.");
  });

  it("shows on the public /guides page: the last section, closed until opened, with its lists and its four tables", () => {
    const { container } = render(<GuidesPage />);
    const sections = [...container.querySelectorAll<HTMLDetailsElement>("details.lobby-guide-section")];
    const section = sections.find((d) => d.querySelector("summary")!.textContent === "Poison & Assassination")!;
    expect(section).toBeDefined();
    expect(sections.indexOf(section)).toBe(sections.length - 1);
    expect(section.open).toBe(false);
    expect(section.querySelector("p.lobby-guide-p")!.textContent).toBe(entry().paragraphs[0]);
    // The blocks wear the page's own paragraph class, and each table sits in its own scrolling box.
    expect(section.querySelector(".guide-blocks")!.classList.contains("lobby-guide-p")).toBe(true);
    expect([...section.querySelectorAll(".guide-table-wrap > table.guide-table > caption")].map((c) => c.textContent)).toEqual(["The two actions", "What counts as defense", "Poison", "Assassination"]);
    expect([...section.querySelectorAll("h4.guide-block-h")].map((h) => h.textContent)).toEqual(["Who can strike, and at whom", "The chance of success", "Examples", "Afterwards"]);
    const poisonTable = [...section.querySelectorAll("table.guide-table")].find((t) => t.querySelector("caption")!.textContent === "Poison")!;
    expect([...poisonTable.querySelectorAll("thead th")].map((th) => th.textContent)).toEqual(table("Poison").columns);
    expect([...poisonTable.querySelectorAll("tbody tr")].map((tr) => [...tr.children].map((c) => c.textContent))).toEqual(table("Poison").rows);
    // The older sections carry no blocks at all.
    expect(sections[0]!.querySelector(".guide-blocks")).toBeNull();
  });

  it("shows in the in-game Guide too, in the sheet's own paragraph class", () => {
    const { container } = render(<GuideSheet open onClose={() => {}} />);
    const wrapper = container.ownerDocument.querySelector(".guide-blocks")!;
    expect(wrapper.classList.contains("guide-p")).toBe(true);
    expect([...wrapper.querySelectorAll("table.guide-table > caption")].map((c) => c.textContent)).toEqual(["The two actions", "What counts as defense", "Poison", "Assassination"]);
    expect(wrapper.querySelectorAll("ul.guide-block-list li")).toHaveLength(lines().length - 2); // every line but the two plain ones
  });
});
