// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { parseStrikesContent } from "@massalia/shared";
import GuideSheet from "../src/dashboard/GuideSheet.js";
import { GUIDE_SECTIONS } from "../src/dashboard/guideContent.js";

// ---------------------------------------------------------------------------
// The Guide's "War & Raids" entry (strikes prompt 1, ruled at STOP 1). Every
// number in it is the content's: content/military/strikes.json (more than 10
// fights within 96 hours, a game year; 12 hours' warning; 2 drachmae a raider),
// battle.json's regen (30% of full strength a season) and league-war.json's
// plunderMultiplier (1.5, "half as much again"). The test reads them back, so
// it goes red when the content moves and the words do not.
// ---------------------------------------------------------------------------

afterEach(cleanup);

const repo = (file: string) => JSON.parse(readFileSync(resolve(process.cwd(), "../..", file), "utf8")) as unknown;
const strikes = parseStrikesContent(repo("content/military/strikes.json"));
const regen = (repo("content/military/battle.json") as { regen: { warbandShare: number; garrisonShare: number } }).regen;
const war = repo("content/politics/league-war.json") as { plunderMultiplier: number };
const entry = () => GUIDE_SECTIONS.find((s) => s.id === "war")!;

describe("the Guide's War & Raids entry", () => {
  it("stands after The City's Politics, with its title", () => {
    const ids = GUIDE_SECTIONS.map((s) => s.id);
    expect(ids.indexOf("war")).toBe(ids.indexOf("politics") + 1);
    expect(entry().title).toBe("War & Raids");
  });

  it("every number in it is the content's", () => {
    const [raids, wars, regrowth] = entry().paragraphs;
    // A game year is 96 hours: four seasons of a day.
    expect(strikes.raids.windowHours).toBe(96);
    expect(raids).toContain(`Raid one place more than ${strikes.raids.moreThan} times in a game year`);
    expect(raids).toContain(`The march is seen ${strikes.warningHours} hours before it strikes`);
    expect(raids).toContain(`takes ${strikes.plunderPerRaider} drachmae for each raider still standing`);
    expect(war.plunderMultiplier).toBe(1.5);
    expect(wars).toContain("raids on the enemy pay half as much again");
    expect(regen.garrisonShare).toBe(regen.warbandShare);
    expect(regrowth).toBe(`Garrisons and warbands win back ${Math.round(regen.garrisonShare * 100)}% of their full strength each season.`);
  });

  it("renders in the Guide sheet", () => {
    const { container } = render(<GuideSheet open onClose={() => {}} />);
    expect(container.textContent).toContain("War & Raids");
    expect(container.textContent).toContain("Every town and land remembers its raiders.");
  });
});
