import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  agendaCycleSeasons,
  canAfford,
  canDraft,
  canVeto,
  cardLeans,
  currentAgendaCycle,
  drawAgendaCards,
  dues,
  festivalDonationCut,
  isAgendaYear,
  parseAgendaFile,
  parsePoliticsConfig,
  seatPurchaseCut,
  type AgendaCard,
  type AgendaConfig,
  type HeldOffice,
} from "./index.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const politics = parsePoliticsConfig(JSON.parse(readFileSync(resolve(root, "content/politics/politics-config.json"), "utf8")));
const agendaCfg: AgendaConfig = politics.agenda;

describe("config: agenda/treasury/dues/endorsement blocks parse", () => {
  it("validates the Prompt 3 config at parse time", () => {
    expect(politics.treasury).toEqual({ leviedPerSeason: 20, seatPurchaseCutFraction: 0.1, festivalDonationCutFraction: 0.2 });
    expect(politics.partyDues.duesPerSeasonPerMember).toBe(5);
    expect(politics.agenda.leagueCardsPerCycle).toBe(3);
    expect(politics.agenda.vetoesPerEphorPerTerm).toBe(1);
    expect(politics.endorsement.swingVotes).toBe(8);
  });
});

describe("content: the three agenda pools load", () => {
  it("league/palaioi/dynatoi card files parse", () => {
    const league = parseAgendaFile(JSON.parse(readFileSync(resolve(root, "content/politics/agenda-league.json"), "utf8")));
    const pal = parseAgendaFile(JSON.parse(readFileSync(resolve(root, "content/politics/agenda-palaioi.json"), "utf8")));
    const dyn = parseAgendaFile(JSON.parse(readFileSync(resolve(root, "content/politics/agenda-dynatoi.json"), "utf8")));
    expect(league.length).toBeGreaterThanOrEqual(8);
    expect(pal.length).toBeGreaterThanOrEqual(6);
    expect(dyn.length).toBeGreaterThanOrEqual(6);
  });
});

describe("treasury math", () => {
  it("seat-purchase cut floors price × fraction", () => {
    expect(seatPurchaseCut(300, politics.treasury)).toBe(30); // 300 × 0.1
    expect(seatPurchaseCut(305, politics.treasury)).toBe(30); // floored
  });
  it("festival-donation cut floors amount × fraction", () => {
    expect(festivalDonationCut(25, politics.treasury)).toBe(5); // 25 × 0.2
  });
  it("dues = per-member dues × member count", () => {
    expect(dues(7, politics.partyDues)).toBe(35);
    expect(dues(0, politics.partyDues)).toBe(0);
  });
  it("canAfford guards an overspend", () => {
    expect(canAfford(50, 50)).toBe(true);
    expect(canAfford(49, 50)).toBe(false);
  });
});

const archonPal: HeldOffice[] = [{ office: "archon", side: "palaioi" }];
const ephorDyn: HeldOffice[] = [{ office: "ephor", side: "dynatoi" }];
const partyArchonPal: HeldOffice[] = [{ office: "party_archon", side: "palaioi" }];
const partyEphorPal: HeldOffice[] = [{ office: "party_ephor", side: "palaioi" }];

describe("canDraft", () => {
  it("a sitting League Archon (either side) drafts the league agenda", () => {
    expect(canDraft(archonPal, "league")).toBe(true);
    expect(canDraft([{ office: "archon", side: "dynatoi" }], "league")).toBe(true);
  });
  it("an Ephor or a plain member cannot draft", () => {
    expect(canDraft(ephorDyn, "league")).toBe(false);
    expect(canDraft([], "league")).toBe(false);
  });
  it("the party Archon of a party drafts that party's agenda only", () => {
    expect(canDraft(partyArchonPal, "palaioi")).toBe(true);
    expect(canDraft(partyArchonPal, "dynatoi")).toBe(false);
    expect(canDraft(archonPal, "palaioi")).toBe(false); // a LEAGUE archon is not a party archon
  });
});

describe("canVeto", () => {
  it("a sitting Ephor of the scope may veto once per term, only while drafting", () => {
    expect(canVeto({ held: ephorDyn, vetoesUsedThisTerm: 0, phase: "drafting" }, "league", agendaCfg)).toBe(true);
    expect(canVeto({ held: ephorDyn, vetoesUsedThisTerm: 1, phase: "drafting" }, "league", agendaCfg)).toBe(false); // used up
    expect(canVeto({ held: ephorDyn, vetoesUsedThisTerm: 0, phase: "voting" }, "league", agendaCfg)).toBe(false); // too late
  });
  it("a non-Ephor cannot veto; party Ephor only their party", () => {
    expect(canVeto({ held: archonPal, vetoesUsedThisTerm: 0, phase: "drafting" }, "league", agendaCfg)).toBe(false);
    expect(canVeto({ held: partyEphorPal, vetoesUsedThisTerm: 0, phase: "drafting" }, "palaioi", agendaCfg)).toBe(true);
    expect(canVeto({ held: partyEphorPal, vetoesUsedThisTerm: 0, phase: "drafting" }, "dynatoi", agendaCfg)).toBe(false);
  });
});

describe("agenda cadence (season clock, offset, no backlog)", () => {
  it("league runs Winter→Summer; party is offset to Summer→Winter", () => {
    const league = agendaCycleSeasons(2, "league", agendaCfg); // year 2 → seasons 8,9,10
    expect(league).toEqual({ draftSeasonIndex: 8, voteSeasonIndex: 9, resolveSeasonIndex: 10 });
    const party = agendaCycleSeasons(2, "palaioi", agendaCfg); // offset 2 → seasons 10,11,12
    expect(party).toEqual({ draftSeasonIndex: 10, voteSeasonIndex: 11, resolveSeasonIndex: 12 });
    expect(league.resolveSeasonIndex).toBeLessThanOrEqual(party.draftSeasonIndex); // league before party
  });
  it("currentAgendaCycle reports drafting then voting, and nothing once past", () => {
    expect(currentAgendaCycle(8, "league", agendaCfg)).toEqual({ gameYear: 2, phase: "drafting" });
    expect(currentAgendaCycle(9, "league", agendaCfg)).toEqual({ gameYear: 2, phase: "voting" });
    expect(currentAgendaCycle(10, "league", agendaCfg)).toBeNull(); // window passed → no retro-fire
    expect(currentAgendaCycle(10, "palaioi", agendaCfg)).toEqual({ gameYear: 2, phase: "drafting" });
  });
  it("isAgendaYear is yearly by default", () => {
    expect(isAgendaYear(0, "league", agendaCfg)).toBe(true);
    expect(isAgendaYear(3, "palaioi", agendaCfg)).toBe(true);
  });
});

describe("cardLeans", () => {
  it("the favored side leans yes; the rest no", () => {
    const card: AgendaCard = { id: "c", title: "t", description: "d", cost: 0, partyLean: "palaioi", effect: { type: "flavor" } };
    expect(cardLeans(card)).toEqual({ palaioi: "yes", dynatoi: "no", independent: "no" });
  });
});

describe("drawAgendaCards", () => {
  const pool: AgendaCard[] = Array.from({ length: 6 }, (_, i) => ({ id: `c${i}`, title: "t", description: "d", cost: 0, partyLean: "independent", effect: { type: "flavor" } }));
  it("draws `count` distinct cards, excluding recently-used", () => {
    const drawn = drawAgendaCards(pool, ["c0", "c1"], 3, () => 0.5);
    expect(drawn).toHaveLength(3);
    expect(new Set(drawn.map((c) => c.id)).size).toBe(3);
    expect(drawn.every((c) => c.id !== "c0" && c.id !== "c1")).toBe(true);
  });
  it("falls back to the full pool when too few fresh cards remain", () => {
    const drawn = drawAgendaCards(pool, pool.map((c) => c.id), 3, () => 0);
    expect(drawn).toHaveLength(3);
  });
});
