import { describe, expect, it } from "vitest";
import {
  ballotPhaseAt,
  canStand,
  canVote,
  excludeClassRules,
  tallyBallot,
  type BallotCandidate,
  type BallotVote,
  type ElectionRules,
} from "./index.js";

// The ballot module is generic — exercise it with a NON-Olympic dummy election
// (a guild master vote) to prove no domain specifics leak into it.
const guildElection: ElectionRules = excludeClassRules("guild-master", 2, ["apprentice"]);

const cand = (characterId: string, prestige: number, nominatedAt: number): BallotCandidate => ({ characterId, prestige, nominatedAt });
const vote = (voterCharacterId: string, candidateCharacterId: string): BallotVote => ({ voterCharacterId, candidateCharacterId });

describe("eligibility predicates", () => {
  it("a living non-excluded actor may stand and vote", () => {
    const actor = { characterId: "a", classId: "smith", status: "alive" };
    expect(canStand(guildElection, actor)).toBe(true);
    expect(canVote(guildElection, actor)).toBe(true);
  });

  it("an excluded class cannot stand but can still vote", () => {
    const apprentice = { characterId: "b", classId: "apprentice", status: "alive" };
    expect(canStand(guildElection, apprentice)).toBe(false);
    expect(canVote(guildElection, apprentice)).toBe(true);
  });

  it("the dead neither stand nor vote", () => {
    const dead = { characterId: "c", classId: "smith", status: "deceased" };
    expect(canStand(guildElection, dead)).toBe(false);
    expect(canVote(guildElection, dead)).toBe(false);
  });
});

describe("ballotPhaseAt", () => {
  const windows = { nominationEndsAt: 100, votingEndsAt: 200 };
  it("walks nomination → voting → closed across the windows", () => {
    expect(ballotPhaseAt(0, windows)).toBe("nomination");
    expect(ballotPhaseAt(99, windows)).toBe("nomination");
    expect(ballotPhaseAt(100, windows)).toBe("voting"); // boundary: nomination closes
    expect(ballotPhaseAt(199, windows)).toBe("voting");
    expect(ballotPhaseAt(200, windows)).toBe("closed"); // boundary: voting closes
  });
});

describe("tallyBallot", () => {
  it("takes the top `seats` by vote count", () => {
    const candidates = [cand("a", 0, 1), cand("b", 0, 2), cand("c", 0, 3)];
    const votes = [vote("v1", "a"), vote("v2", "a"), vote("v3", "b"), vote("v4", "c"), vote("v5", "c"), vote("v6", "c")];
    const { winners } = tallyBallot(candidates, votes, 2);
    expect(winners).toEqual(["c", "a"]); // c=3, a=2 win; b=1 loses
  });

  it("breaks vote ties by prestige, then earliest nomination", () => {
    // a, b, c all tie on 1 vote each for the final seat decision.
    const candidates = [cand("a", 5, 30), cand("b", 9, 20), cand("c", 9, 10)];
    const votes = [vote("v1", "a"), vote("v2", "b"), vote("v3", "c")];
    const { winners } = tallyBallot(candidates, votes, 2);
    // b and c tie on prestige 9; c nominated earlier (10 < 20) → c first, then b.
    expect(winners).toEqual(["c", "b"]);
  });

  it("ignores votes cast for unknown (non-candidate) characters", () => {
    const candidates = [cand("a", 0, 1), cand("b", 0, 2)];
    const votes = [vote("v1", "ghost"), vote("v2", "a")];
    const { winners, standings } = tallyBallot(candidates, votes, 2);
    expect(winners).toEqual(["a", "b"]);
    expect(standings.find((s) => s.characterId === "a")!.votes).toBe(1);
    expect(standings.find((s) => s.characterId === "b")!.votes).toBe(0);
  });

  it("fewer candidates than seats → every candidate wins (1 candidate)", () => {
    const { winners } = tallyBallot([cand("solo", 0, 1)], [vote("v1", "solo")], 2);
    expect(winners).toEqual(["solo"]);
  });

  it("zero candidates → no winners", () => {
    const { winners } = tallyBallot([], [], 2);
    expect(winners).toEqual([]);
  });

  it("counts one vote per voter (the upsert keeps a single row upstream)", () => {
    const candidates = [cand("a", 0, 1), cand("b", 0, 2)];
    const votes = [vote("v1", "a"), vote("v2", "b"), vote("v3", "b")];
    const { standings } = tallyBallot(candidates, votes, 2);
    expect(standings.find((s) => s.characterId === "b")!.votes).toBe(2);
  });
});
