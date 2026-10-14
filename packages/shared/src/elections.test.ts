import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  APPOINT_REFUSAL,
  canDeclare,
  ephorAppointRefusal,
  strategosAppointRefusal,
  currentElectionCycle,
  electionCalendar,
  electionConfig,
  electionCycleFor,
  holderForfeitsOffice,
  isElectionYear,
  parseCalendarConfig,
  parsePoliticsConfig,
  resolveElection,
  SEASONS_PER_YEAR,
  type ElectionCandidate,
  type ElectionConfig,
  type ElectionNpcBloc,
} from "./index.js";
import type { BallotVote } from "./ballot.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const calendar = parseCalendarConfig(JSON.parse(readFileSync(resolve(root, "content/calendar/calendar-config.json"), "utf8")));
const politics = parsePoliticsConfig(JSON.parse(readFileSync(resolve(root, "content/politics/politics-config.json"), "utf8")));
const cfg: ElectionConfig = electionConfig(calendar);

describe("config", () => {
  it("parses the election block with the constitution's tuning", () => {
    expect(cfg.termPeriods).toBe(24); // 6 game years
    expect(cfg.termPeriods / SEASONS_PER_YEAR).toBe(6);
    expect(cfg.cadenceYears).toBe(6);
    expect(cfg.declareSeasonOffset).toBe(1); // Spring
    expect(cfg.voteSeasonOffset).toBe(4); // next Winter
    expect(cfg.officeSeasonOffset).toBe(5); // following Spring
    expect(cfg.maxTermsPerCharacter).toBe(2);
  });

  it("defines archon + ephor with one seat per side, plus strategoi", () => {
    expect(politics.offices.elected.map((o) => o.office).sort()).toEqual(["archon", "ephor"]);
    for (const office of politics.offices.elected) expect(office.sides.sort()).toEqual(["dynatoi", "palaioi"]);
    expect(politics.offices.strategoi.count).toBe(2);
    expect(politics.offices.strategoi.crossPartyBalance).toBe(true);
    // Strategoi prompt 1: a Strategos needs a sheet Militia above 40.
    expect(politics.offices.strategoi.militiaAbove).toBe(40);
  });
});

describe("the election calendar (season-clock cadence)", () => {
  it("declares Spring, votes Winter (3 seasons later), takes office the following Spring", () => {
    const { cycle } = electionCalendar(6, cfg);
    // dueYear 6: Winter index = 24. declare Spring=25, vote Winter=28, office Spring=29.
    expect(cycle.declareSeasonIndex % SEASONS_PER_YEAR).toBe(1); // Spring
    expect(cycle.voteSeasonIndex % SEASONS_PER_YEAR).toBe(0); // Winter
    expect(cycle.officeSeasonIndex % SEASONS_PER_YEAR).toBe(1); // Spring
    expect(cycle.voteSeasonIndex - cycle.declareSeasonIndex).toBe(3); // 3 seasons later
    expect(cycle.officeYear).toBe(7); // the following year's Spring
    expect(cycle.termEndsYear).toBe(13); // office year 7 + 6-year term
  });

  it("an election year is every cadence, skipping year 0", () => {
    expect(isElectionYear(0, cfg)).toBe(false);
    expect(isElectionYear(6, cfg)).toBe(true);
    expect(isElectionYear(7, cfg)).toBe(false);
    expect(isElectionYear(42, cfg)).toBe(true);
    // ~7 elections across a 182-season (≈45.5 year) server.
    const due = Array.from({ length: 46 }, (_, y) => y).filter((y) => isElectionYear(y, cfg));
    expect(due).toEqual([6, 12, 18, 24, 30, 36, 42]);
  });
});

describe("currentElectionCycle — the no-backlog primitive", () => {
  const cycle = electionCycleFor(6, cfg); // declare 25, vote 28, office 29

  it("reports declaration only inside [declare, vote)", () => {
    expect(currentElectionCycle(cycle.declareSeasonIndex, cfg)?.phase).toBe("declaration");
    expect(currentElectionCycle(cycle.voteSeasonIndex - 1, cfg)?.phase).toBe("declaration");
  });

  it("reports voting only inside [vote, office)", () => {
    expect(currentElectionCycle(cycle.voteSeasonIndex, cfg)?.phase).toBe("voting");
    expect(currentElectionCycle(cycle.officeSeasonIndex - 1, cfg)?.phase).toBe("voting");
  });

  it("reports NOTHING before declaration or once office is reached (no retro-fire)", () => {
    expect(currentElectionCycle(cycle.declareSeasonIndex - 1, cfg)).toBeNull();
    expect(currentElectionCycle(cycle.officeSeasonIndex, cfg)).toBeNull(); // past the live window
    expect(currentElectionCycle(cycle.officeSeasonIndex + 10, cfg)).toBeNull();
    // A non-election year mid-stream: nothing live.
    expect(currentElectionCycle(40, cfg)).toBeNull();
  });
});

describe("canDeclare", () => {
  const base = {
    status: "alive",
    isSeatHolder: true,
    isRegent: false,
    party: "palaioi",
    side: "palaioi" as const,
    electedTermsInOffice: 0,
  };

  it("allows a living, seat-holding party member on their own side", () => {
    expect(canDeclare(base, cfg).ok).toBe(true);
  });

  it("requires an oligarch seat", () => {
    expect(canDeclare({ ...base, isSeatHolder: false }, cfg)).toMatchObject({ ok: false });
  });

  it("bars the dead and regents", () => {
    expect(canDeclare({ ...base, status: "deceased" }, cfg).ok).toBe(false);
    expect(canDeclare({ ...base, isRegent: true }, cfg).ok).toBe(false);
  });

  it("a party leader may stand: there is no leadership bar in the input (politics prompt 3b)", () => {
    // The bar was a field the server set from the party_archon / party_ephor
    // seats; it is gone, so the input has no way to express it and a living,
    // seated leader on their own side passes like any other member.
    expect("barredFromLeagueOffice" in base).toBe(false);
    expect(canDeclare(base, cfg)).toEqual({ ok: true });
  });

  it("a party member may only stand on their own side", () => {
    expect(canDeclare({ ...base, party: "dynatoi", side: "palaioi" }, cfg).ok).toBe(false);
    expect(canDeclare({ ...base, party: "dynatoi", side: "dynatoi" }, cfg).ok).toBe(true);
  });

  it("an independent may stand on EITHER side", () => {
    expect(canDeclare({ ...base, party: "none", side: "palaioi" }, cfg).ok).toBe(true);
    expect(canDeclare({ ...base, party: "none", side: "dynatoi" }, cfg).ok).toBe(true);
  });

  it("enforces the 2-term limit on ELECTED terms only", () => {
    expect(canDeclare({ ...base, electedTermsInOffice: 1 }, cfg).ok).toBe(true);
    expect(canDeclare({ ...base, electedTermsInOffice: 2 }, cfg).ok).toBe(false);
  });
});

describe("resolveElection — per-side plurality with NPC blocs + favor-sway", () => {
  const cand = (id: string, side: "palaioi" | "dynatoi", party: string, prestige = 0, declaredAt = 0): ElectionCandidate => ({
    characterId: id,
    side,
    party,
    prestige,
    declaredAt,
  });
  const votesFor = (pairs: [string, string][]): BallotVote[] => pairs.map(([v, c]) => ({ voterCharacterId: v, candidateCharacterId: c }));

  it("picks the per-side plurality winner", () => {
    const candidates = [cand("P1", "palaioi", "palaioi"), cand("D1", "dynatoi", "dynatoi")];
    const votes = votesFor([["v1", "P1"], ["v2", "P1"], ["v3", "D1"]]);
    const out = resolveElection(candidates, votes, [], {});
    expect(out.winners).toEqual({ palaioi: "P1", dynatoi: "D1" });
  });

  it("CROSS-PARTY KINGMAKING: Dynatoi voters crown a Palaioi candidate for the Palaioi seat", () => {
    // Two Palaioi candidates. Palaioi voters prefer PA; Dynatoi voters pile onto PB.
    const candidates = [cand("PA", "palaioi", "palaioi"), cand("PB", "palaioi", "palaioi"), cand("D1", "dynatoi", "dynatoi")];
    const votes = votesFor([
      ["pal1", "PA"],
      ["pal2", "PA"], // 2 Palaioi-aligned votes for PA
      ["dyn1", "PB"],
      ["dyn2", "PB"],
      ["dyn3", "PB"], // 3 Dynatoi-aligned votes for PB
      ["dyn4", "D1"],
    ]);
    const out = resolveElection(candidates, votes, [], {});
    expect(out.winners.palaioi).toBe("PB"); // crowned by Dynatoi votes
    expect(out.winners.dynatoi).toBe("D1");
  });

  it("favor-sway adds NPC swing votes toward a candidate", () => {
    const candidates = [cand("PA", "palaioi", "palaioi"), cand("PB", "palaioi", "palaioi")];
    const votes = votesFor([["v1", "PA"], ["v2", "PB"]]); // tied on player votes
    const out = resolveElection(candidates, votes, [], { PB: 3 }); // PB sways 3 swing NPCs
    expect(out.winners.palaioi).toBe("PB");
  });

  it("the NPC base bloc rallies behind its strongest same-side candidate", () => {
    const candidates = [cand("PA", "palaioi", "palaioi"), cand("PB", "palaioi", "palaioi")];
    const votes = votesFor([["v1", "PA"]]); // PA leads on player votes
    const blocs: ElectionNpcBloc[] = [{ party: "palaioi", base: 40 }];
    const out = resolveElection(candidates, votes, blocs, {});
    expect(out.winners.palaioi).toBe("PA"); // 1 + 40 base vs 0
    expect(out.totals.find((t) => t.characterId === "PA")!.total).toBe(41);
  });

  it("tie-break is prestige, then earliest declaration", () => {
    const tiedVotes = votesFor([["v1", "A"], ["v2", "B"]]);
    // A and B both 1 vote; B has higher prestige → B wins.
    expect(
      resolveElection([cand("A", "palaioi", "palaioi", 5, 100), cand("B", "palaioi", "palaioi", 9, 200)], tiedVotes, [], {}).winners.palaioi,
    ).toBe("B");
    // Equal prestige → earliest declaration wins (A declared first).
    expect(
      resolveElection([cand("A", "palaioi", "palaioi", 5, 100), cand("B", "palaioi", "palaioi", 5, 200)], tiedVotes, [], {}).winners.palaioi,
    ).toBe("A");
  });

  it("a side with no candidate has a null winner", () => {
    const out = resolveElection([cand("P1", "palaioi", "palaioi")], [], [], {});
    expect(out.winners.palaioi).toBe("P1");
    expect(out.winners.dynatoi).toBeNull();
  });

  it("never returns per-voter data — totals only", () => {
    const out = resolveElection([cand("P1", "palaioi", "palaioi")], votesFor([["secret-voter", "P1"]]), [], {});
    expect(JSON.stringify(out)).not.toContain("secret-voter");
  });
});

describe("holderForfeitsOffice (defection)", () => {
  it("a party member forfeits the moment their party leaves the side (to none or flipped)", () => {
    expect(holderForfeitsOffice("palaioi", "palaioi", false)).toBe(false); // still aligned
    expect(holderForfeitsOffice("none", "palaioi", false)).toBe(true); // left to none (or censure-kick)
    expect(holderForfeitsOffice("dynatoi", "palaioi", false)).toBe(true); // flipped to the other party
  });

  it("an independent keeps the seat as 'none', forfeiting only on joining the opposing party", () => {
    expect(holderForfeitsOffice("none", "palaioi", true)).toBe(false); // stays independent — keeps it
    expect(holderForfeitsOffice("palaioi", "palaioi", true)).toBe(false); // joined the matching party — fine
    expect(holderForfeitsOffice("dynatoi", "palaioi", true)).toBe(true); // joined the opposing party — forfeit
  });
});

// Strategoi prompt 1: one rule for the appointment and the picker's list.
describe("who may be appointed", () => {
  const RULE = { militiaAbove: 40, crossPartyBalance: true };
  const man = (over: Partial<Parameters<typeof strategosAppointRefusal>[0]> = {}) => ({ status: "alive", isSeatHolder: true, isRegent: false, party: "none", sheetMilitia: 41, holdsLeagueSeat: false, abroad: false, ...over });

  it("a Strategos: any class, either party or none, with a sheet Militia above 40", () => {
    expect(strategosAppointRefusal(man(), RULE, [])).toBeNull();
    expect(strategosAppointRefusal(man({ party: "palaioi" }), RULE, [])).toBeNull();
    expect(strategosAppointRefusal(man({ sheetMilitia: 40 }), RULE, [])).toBe("A Strategos needs a Militia above 40.");
    expect(strategosAppointRefusal(man({ sheetMilitia: 100 }), RULE, [])).toBeNull();
    expect(APPOINT_REFUSAL.militia(55)).toBe("A Strategos needs a Militia above 55.");
  });

  it("a Strategos: not one who holds a League seat, is abroad, is dead, holds no seat or is a regent", () => {
    expect(strategosAppointRefusal(man({ holdsLeagueSeat: true }), RULE, [])).toBe("He already holds one of the city's offices.");
    expect(strategosAppointRefusal(man({ abroad: true }), RULE, [])).toBe("He is abroad on a mercenary contract.");
    expect(strategosAppointRefusal(man({ status: "dead" }), RULE, [])).toBe("The dead cannot take office.");
    expect(strategosAppointRefusal(man({ isSeatHolder: false }), RULE, [])).toBe("The appointee must hold an oligarch seat.");
    expect(strategosAppointRefusal(man({ isRegent: true }), RULE, [])).toBe("A regent may not hold elected office.");
  });

  it("a Strategos: the parties balance; a man of no party passes, and the rule can be turned off", () => {
    expect(strategosAppointRefusal(man({ party: "palaioi" }), RULE, ["palaioi"])).toBe("The Strategoi must balance the parties — the other seat already holds this party.");
    expect(strategosAppointRefusal(man({ party: "dynatoi" }), RULE, ["palaioi"])).toBeNull();
    expect(strategosAppointRefusal(man({ party: "none" }), RULE, ["palaioi"])).toBeNull();
    expect(strategosAppointRefusal(man({ party: "palaioi" }), { ...RULE, crossPartyBalance: false }, ["palaioi"])).toBeNull();
  });

  it("an Ephor of a side: of that party or none, holding no League seat, whatever his Militia", () => {
    expect(ephorAppointRefusal(man({ party: "palaioi", sheetMilitia: 3 }), "palaioi")).toBeNull();
    expect(ephorAppointRefusal(man({ party: "none" }), "dynatoi")).toBeNull();
    expect(ephorAppointRefusal(man({ party: "dynatoi" }), "palaioi")).toBe("The appointee's party does not match the side.");
    expect(ephorAppointRefusal(man({ party: "palaioi", holdsLeagueSeat: true }), "palaioi")).toBe("He already holds one of the city's offices.");
    // Abroad is no bar to an Ephor's seat: the contract keeps his vote.
    expect(ephorAppointRefusal(man({ party: "palaioi", abroad: true }), "palaioi")).toBeNull();
  });
});
