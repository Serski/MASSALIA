import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  chamberVoteDueAt,
  dailyArenasFor,
  eventArena,
  drawEvent,
  isEventEligible,
  nextSeasonBoundaryMs,
  npcBlocVotes,
  parseEventFile,
  parsePoliticsConfig,
  questionForYear,
  swayedVotes,
  tallyChamber,
  REAL_MS_PER_SEASON,
  type ChamberConfig,
  type EligibilityContext,
  type NpcBlocResult,
} from "./index.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const politics = parsePoliticsConfig(JSON.parse(readFileSync(resolve(root, "content/politics/politics-config.json"), "utf8")));
const chamber: ChamberConfig = politics.chamber;

describe("politics-config.json", () => {
  it("parses with the spec'd chamber tuning", () => {
    expect(chamber.capacity).toBe(300);
    expect(chamber.seatPrice).toBe(300);
    expect(chamber.npcSeats).toEqual({ palaioi: 50, dynatoi: 50, independent: 10 });
    expect(chamber.npcSwingFraction).toBe(0.2);
    expect(chamber.favorPerSwingVote).toBe(5);
    expect(chamber.chamberVoteCadenceGameYears).toBe(1);
    expect(chamber.questions.length).toBeGreaterThanOrEqual(3);
    expect(chamber.questions.length).toBeLessThanOrEqual(4);
  });

  it("rejects npc blocs that overflow the chamber", () => {
    const bad = JSON.parse(JSON.stringify({ chamber }));
    bad.chamber.npcSeats.palaioi = 291;
    expect(() => parsePoliticsConfig(bad)).toThrow();
  });
});

describe("npcBlocVotes", () => {
  it("votes the base lean with floor(blocSize × swingFraction) swayable", () => {
    const bloc = npcBlocVotes(50, 0.2, "yes", "palaioi");
    expect(bloc).toMatchObject({ blocSize: 50, swingSize: 10, lean: "yes", yes: 50, no: 0 });
  });

  it("floors the swing size", () => {
    expect(npcBlocVotes(10, 0.25, "no").swingSize).toBe(2); // 2.5 -> 2
    expect(npcBlocVotes(3, 0.2, "no").swingSize).toBe(0);
  });
});

describe("swayedVotes", () => {
  it("converts favor to swung votes (favor 12 / 5-per-vote = 2)", () => {
    expect(swayedVotes(12, 5, 10)).toBe(2);
  });

  it("caps at the bloc's swing size", () => {
    expect(swayedVotes(500, 5, 10)).toBe(10);
  });

  it("sways nobody on zero/negative favor", () => {
    expect(swayedVotes(0, 5, 10)).toBe(0);
    expect(swayedVotes(-20, 5, 10)).toBe(0);
    expect(swayedVotes(4, 5, 10)).toBe(0);
  });
});

describe("tallyChamber", () => {
  const blocs: NpcBlocResult[] = [
    npcBlocVotes(50, 0.2, "no", "palaioi"), // swing 10
    npcBlocVotes(50, 0.2, "yes", "dynatoi"), // swing 10
    npcBlocVotes(10, 0.2, "yes", "independent"), // swing 2
  ];

  it("sums NPC leans + player ballots with no sway", () => {
    const tally = tallyChamber(blocs, ["yes", "yes", "no"], {});
    expect(tally).toEqual({ yes: 50 + 10 + 2, no: 50 + 1, passed: true });
  });

  it("flips swing NPCs against their lean, capped at the bloc's swing size", () => {
    // 25 yes-sway on the palaioi (lean no, swing 10): only 10 flip.
    const tally = tallyChamber(blocs, [], { palaioi: { yes: 25, no: 0 } });
    expect(tally.yes).toBe(60 + 10);
    expect(tally.no).toBe(40);
  });

  it("anchoring sway toward the lean cancels opposing sway but never adds votes", () => {
    // palaioi lean no: 6 toward yes vs 4 toward no -> net 2 flip.
    const net = tallyChamber(blocs, [], { palaioi: { yes: 6, no: 4 } });
    expect(net.no).toBe(48);
    expect(net.yes).toBe(62);
    // Pure anchoring (toward the lean) changes nothing.
    const anchored = tallyChamber(blocs, [], { palaioi: { yes: 0, no: 9 } });
    expect(anchored).toMatchObject({ yes: 60, no: 50 });
  });

  it("a vote passes only when yes outnumbers no (a tie fails)", () => {
    const even: NpcBlocResult[] = [npcBlocVotes(10, 0, "yes"), npcBlocVotes(10, 0, "no")];
    expect(tallyChamber(even, [], {}).passed).toBe(false);
    expect(tallyChamber(even, ["yes"], {}).passed).toBe(true);
  });

  it("prompt example: favor 12 with favorPerSwingVote 5 sways 2 of the player's own bloc", () => {
    const sway = swayedVotes(12, chamber.favorPerSwingVote, npcBlocVotes(50, chamber.npcSwingFraction, "no", "palaioi").swingSize);
    expect(sway).toBe(2);
    const tally = tallyChamber(blocs, ["yes"], { palaioi: { yes: sway, no: 0 } });
    expect(tally.yes).toBe(60 + 1 + 2);
    expect(tally.no).toBe(48);
  });
});

describe("the yearly vote on the season clock", () => {
  it("rotates the question pool by game year", () => {
    const pool = chamber.questions;
    expect(questionForYear(chamber, 0)).toBe(pool[0]);
    expect(questionForYear(chamber, 1)).toBe(pool[1]);
    expect(questionForYear(chamber, pool.length)).toBe(pool[0]);
  });

  it("is due once per cadence year", () => {
    expect(chamberVoteDueAt(chamber, 0)).toBe(true);
    expect(chamberVoteDueAt(chamber, 1)).toBe(true); // cadence 1: every year
    expect(chamberVoteDueAt({ ...chamber, chamberVoteCadenceGameYears: 2 }, 1)).toBe(false);
    expect(chamberVoteDueAt({ ...chamber, chamberVoteCadenceGameYears: 2 }, 2)).toBe(true);
  });

  it("closes at the next season boundary", () => {
    const started = 1_000_000;
    expect(nextSeasonBoundaryMs(started, started)).toBe(started + REAL_MS_PER_SEASON);
    expect(nextSeasonBoundaryMs(started + REAL_MS_PER_SEASON / 2, started)).toBe(started + REAL_MS_PER_SEASON);
    expect(nextSeasonBoundaryMs(started + REAL_MS_PER_SEASON, started)).toBe(started + 2 * REAL_MS_PER_SEASON);
  });
});

describe("a fresh seat-holder draws the council (cou-*) events", () => {
  const councilEvents = parseEventFile(JSON.parse(readFileSync(resolve(root, "content/events/events-council.json"), "utf8")));
  const councilor: EligibilityContext = {
    classId: "trader",
    party: "none",
    isCouncilor: true,
    stats: { prestige: 0, devotion: 0, militia: 0, intelligence: 0 },
    traitIds: [],
    married: false,
    spouseTraitIds: [],
    livingChildren: [],
  };

  it("the council pack is gated on the councilor office (the is_councilor flag)", () => {
    expect(councilEvents.length).toBeGreaterThan(0);
    for (const event of councilEvents) {
      expect(event.id.startsWith("cou-")).toBe(true);
      expect(event.requires?.office).toBe("councilor");
      expect(eventArena(event)).toBe("council");
      expect(isEventEligible(event, councilor)).toBe(true);
      expect(isEventEligible(event, { ...councilor, isCouncilor: false })).toBe(false);
    }
  });

  it("buying a seat adds the council arena to the daily set", () => {
    expect(dailyArenasFor({ ...councilor, isCouncilor: false }, false)).not.toContain("council");
    expect(dailyArenasFor(councilor, false)).toContain("council");
    const drawn = drawEvent(councilEvents.filter((event) => isEventEligible(event, councilor)), [], () => 0.5);
    expect(drawn?.id.startsWith("cou-")).toBe(true);
  });
});
