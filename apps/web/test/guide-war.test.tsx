// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { parseStrikesContent } from "@massalia/shared";
import GuideSheet from "../src/dashboard/GuideSheet.js";
import { GUIDE_SECTIONS } from "../src/dashboard/guideContent.js";

// ---------------------------------------------------------------------------
// The Guide's "War & Raids" entry (strikes prompt 1, ruled at STOP 1; Military
// 6a, ruled at STOP 2). Every number in it is the content's:
// content/military/strikes.json (more than 10 fights within 96 hours, a game
// year; 12 hours' warning; 2 drachmae a raider), battle.json's alert.share (on
// alert at 50%), raid.rounds and rounds (2 and 3), holdings.maxPerHouse (2) and
// regen (30% of full strength a season), and league-war.json's
// plunderMultiplier (1.5, "half as much again"). The test reads them back, so
// it goes red when the content moves and the words do not.
// ---------------------------------------------------------------------------

afterEach(cleanup);

const repo = (file: string) => JSON.parse(readFileSync(resolve(process.cwd(), "../..", file), "utf8")) as unknown;
const strikes = parseStrikesContent(repo("content/military/strikes.json"));
const battle = repo("content/military/battle.json") as { rounds: number; raid: { rounds: number }; alert: { share: number }; holdings: { maxPerHouse: number }; regen: { warbandShare: number; garrisonShare: number } };
const regen = battle.regen;
const war = repo("content/politics/league-war.json") as { plunderMultiplier: number };
const entry = () => GUIDE_SECTIONS.find((s) => s.id === "war")!;

describe("the Guide's War & Raids entry", () => {
  it("stands after The City's Politics, with its title", () => {
    const ids = GUIDE_SECTIONS.map((s) => s.id);
    expect(ids.indexOf("war")).toBe(ids.indexOf("politics") + 1);
    expect(entry().title).toBe("War & Raids");
  });

  it("every number in it is the content's", () => {
    const [raids, wars, alert, rounds, cap, regrowth] = entry().paragraphs;
    expect(entry().paragraphs).toHaveLength(6);
    // A game year is 96 hours: four seasons of a day.
    expect(strikes.raids.windowHours).toBe(96);
    expect(raids).toContain(`Raid one place more than ${strikes.raids.moreThan} times in a game year`);
    expect(raids).toContain("its people come back with the men they have");
    expect(raids).toContain(`The march is seen ${strikes.warningHours} hours before it strikes`);
    expect(raids).toContain(`takes ${strikes.plunderPerRaider} drachmae for each raider still standing`);
    expect(war.plunderMultiplier).toBe(1.5);
    expect(wars).toContain("raids on the enemy pay half as much again");
    // Military 6a: the alert, the rounds, the skirmishers and the cap.
    const half = Math.round(battle.alert.share * 100);
    expect(alert).toBe(`A town or land down to ${half}% of its full strength is on alert, and the map shows it. No raid can be made there until it regrows above ${half}%, and a raid already on the road turns back at its gates. Scouts and attacks still go, and a place on alert sends no march until it recovers.`);
    expect(rounds).toBe(`A raid is fought over ${battle.raid.rounds} rounds, an attack over ${battle.rounds}. When an attack ends with only skirmishers left defending, they fall back and the place is taken.`);
    expect(cap).toBe(`A house holds ${battle.holdings.maxPerHouse} places at most.`);
    expect(regen.garrisonShare).toBe(regen.warbandShare);
    expect(regrowth).toBe(`Garrisons and warbands win back ${Math.round(regen.garrisonShare * 100)}% of their full strength each season.`);
  });

  it("renders in the Guide sheet", () => {
    const { container } = render(<GuideSheet open onClose={() => {}} />);
    expect(container.textContent).toContain("War & Raids");
    expect(container.textContent).toContain("Every town and land remembers its raiders.");
  });
});
