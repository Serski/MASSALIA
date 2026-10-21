import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { seasonAt } from "./buildings.js";
import { buildTopology, parseCoastLinks, parseMapGraph } from "./mapGraph.js";
import {
  aboutMen,
  apportion,
  chooseTarget,
  deadOffDraws,
  fightsAtPeace,
  landStepsBetween,
  marchIsFight,
  musterIsFight,
  parseStrikesContent,
  polisPeopleLost,
  raidsCallAt,
  raidsFireAt,
  raidsForce,
  raidsTargets,
  raidsWindowMs,
  raidTakes,
  seasonStartMs,
  strikeLines,
  strikeNation,
  strikeWarningMs,
  warCallAt,
  warForce,
  warTargets,
  type NationPlace,
  type StrikeOption,
  type StrikeTarget,
} from "./strikes.js";

// ---------------------------------------------------------------------------
// Strikes prompt 1: the pure rules, on the real map and content. The Volcae
// hold Nemausus (R045, 200) and Tolosa (R042, 2,300); Agathe (R050) borders
// both, Arelate (R052) Nemausus alone. The Sordones hold the land R057 (400),
// next to Agathe, Rhoda and Emporion.
// ---------------------------------------------------------------------------

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (rel: string) => JSON.parse(readFileSync(resolve(root, rel), "utf8"));
const t = buildTopology(parseMapGraph(read("content/map/graph.json")), parseCoastLinks(read("content/map/coast-links.json")));
const c = parseStrikesContent(read("content/military/strikes.json"));
const towns = read("content/map/town-military.json").towns as Record<string, { owner: string; garrison: number }>;
const regions = read("content/map/region-military.json").regions as Record<string, { owner: string; warband: number }>;
const LEAGUE_TOWNS = (read("content/military/league-army.json").towns as { townId: string }[]).map((x) => x.townId);

const HOUR = 3_600_000;
const SEASON = 24 * HOUR;
const T0 = Date.UTC(2000, 0, 1); // season 0 is a Winter
const at = (season: number) => T0 + season * SEASON;

// A nation's places at full strength (or as given).
function landOf(owner: string, men: Record<string, number> = {}): NationPlace[] {
  const out: NationPlace[] = [];
  for (const [id, x] of Object.entries(towns)) if (x.owner === owner) out.push({ placeId: id, kind: "town", regionId: t.townRegion.get(id)!, men: men[id] ?? x.garrison, full: x.garrison });
  for (const [id, x] of Object.entries(regions)) if (x.owner === owner) out.push({ placeId: id, kind: "region", regionId: id, men: men[id] ?? x.warband, full: x.warband });
  return out;
}
const home = (townId: string, defenders: number): StrikeTarget => ({ placeId: townId, regionId: t.townRegion.get(townId)!, townId, kind: "home", holderPlayerId: null, takenFrom: false, name: townId.charAt(0).toUpperCase() + townId.slice(1), full: towns[townId]!.garrison, defenders });
const holding = (placeId: string, defenders: number, takenFrom = false): StrikeTarget => {
  const isTown = t.townRegion.has(placeId);
  return { placeId, regionId: isTown ? t.townRegion.get(placeId)! : placeId, townId: isTown ? placeId : null, kind: "holding", holderPlayerId: "p-holder", takenFrom, name: placeId, full: isTown ? towns[placeId]!.garrison : regions[placeId]!.warband, defenders };
};
const homes = (defenders: Record<string, number> = {}) => LEAGUE_TOWNS.map((id) => home(id, defenders[id] ?? 100));
const option = (target: StrikeTarget, force: number, steps = 1): StrikeOption => ({ ...target, force, draws: [], steps });

describe("the strikes' content", () => {
  it("reads the numbers from content", () => {
    expect(c).toMatchObject({ forceShare: 0.2, warningHours: 12, plunderPerRaider: 2, raidRounds: 1, polis: { peopleLoss: 0.02, stabilityLoss: 1 }, raids: { moreThan: 10, windowHours: 96 } });
    expect(strikeWarningMs(c)).toBe(12 * HOUR);
    expect(raidsWindowMs(c)).toBe(96 * HOUR);
    expect(() => parseStrikesContent({ ...read("content/military/strikes.json"), extra: 1 })).toThrow();
    // A strike fought as a raid fights a whole, positive number of rounds.
    expect(() => parseStrikesContent({ ...read("content/military/strikes.json"), raidRounds: 0 })).toThrow();
    expect(() => parseStrikesContent({ ...read("content/military/strikes.json"), raidRounds: 1.5 })).toThrow();
    const { raidRounds: _dropped, ...withoutRounds } = read("content/military/strikes.json");
    expect(() => parseStrikesContent(withoutRounds)).toThrow();
  });
});

describe("the targets", () => {
  const volcae = landOf("volcae");
  it("the Volcae's home-town targets are Agathe and Arelate", () => {
    expect(warTargets(t, homes(), [], volcae).map((x) => x.placeId).sort()).toEqual(["agathe", "arelate"]);
  });
  it("a holding next to their land is a target, one taken from them is wherever it is, and another is not", () => {
    const targets = warTargets(t, [], [holding("R046", 10), holding("aleria", 5, true), holding("segusio", 98)], volcae);
    expect(targets.map((x) => x.placeId)).toEqual(["R046", "aleria"]);
  });
  it("a raids march's targets are the home towns and holdings next to the raided place", () => {
    expect(raidsTargets(t, homes(), [holding("segusio", 98)], "R057").map((x) => x.placeId).sort()).toEqual(["agathe", "emporion", "rhoda"]);
  });
});

describe("the force", () => {
  it("a war march: a fifth of the men in its towns and lands next to the target, drawn in proportion", () => {
    const volcae = landOf("volcae");
    expect(warForce(t, home("agathe", 100), volcae, c.forceShare)).toEqual({ force: 500, draws: [{ placeId: "nemausus", kind: "town", men: 40 }, { placeId: "tolosa", kind: "town", men: 460 }] });
    expect(warForce(t, home("arelate", 100), volcae, c.forceShare)).toEqual({ force: 40, draws: [{ placeId: "nemausus", kind: "town", men: 40 }] });
    // As they stand: Nemausus at 67.
    expect(warForce(t, home("agathe", 100), landOf("volcae", { nemausus: 67 }), c.forceShare).force).toBe(473);
  });
  it("against a place taken from it, at least that place's full strength", () => {
    expect(warForce(t, holding("aleria", 5, true), landOf("volcae"), c.forceShare)).toMatchObject({ force: towns.aleria!.garrison, draws: [] });
    // Taken from them and next to their land: the larger of the two.
    expect(warForce(t, { regionId: "R050", takenFrom: true, full: 10 }, landOf("volcae"), c.forceShare).force).toBe(500);
  });
  it("a raids march: what the raided place has at the call, never more than its full strength, all drawn from it (Military 6a, ruling 3)", () => {
    const r057 = landOf("sordones").find((p) => p.placeId === "R057")!;
    const asItStands = (men: number): NationPlace => ({ ...r057, men });
    expect(raidsForce(asItStands(400))).toEqual({ force: 400, draws: [{ placeId: "R057", kind: "region", men: 400 }] });
    expect(raidsForce(asItStands(260))).toEqual({ force: 260, draws: [{ placeId: "R057", kind: "region", men: 260 }] });
    // A pool above its full strength sends no more than full; an empty one sends nobody.
    expect(raidsForce(asItStands(500))).toEqual({ force: 400, draws: [{ placeId: "R057", kind: "region", men: 400 }] });
    expect(raidsForce(asItStands(0))).toEqual({ force: 0, draws: [] });
  });
  it("the dead come off the draws in proportion, never more than a draw sent", () => {
    expect(deadOffDraws(100, [{ placeId: "nemausus", kind: "town", men: 40 }, { placeId: "tolosa", kind: "town", men: 460 }])).toEqual([{ placeId: "nemausus", kind: "town", men: 8 }, { placeId: "tolosa", kind: "town", men: 92 }]);
    expect(deadOffDraws(900, [{ placeId: "nemausus", kind: "town", men: 40 }]).map((d) => d.men)).toEqual([40]);
    expect(apportion(5, [2, 2, 2])).toEqual([2, 2, 1]);
    expect(apportion(5, [1, 1, 1])).toEqual([1, 1, 1]); // never above a weight
  });
  it("the shown number is to the nearest 10", () => {
    expect([473, 475, 4, 500].map(aboutMen)).toEqual([470, 480, 0, 500]);
  });
});

describe("the choice", () => {
  it("the target its force most outnumbers", () => {
    expect(chooseTarget([option(home("agathe", 100), 500), option(home("arelate", 100), 140)])!.placeId).toBe("agathe");
  });
  it("ties go to a place taken from it, then the nearer, then by name", () => {
    expect(chooseTarget([option(home("agathe", 100), 200), option(holding("aleria", 0, true), 100, 9)])!.placeId).toBe("aleria");
    expect(chooseTarget([option(home("agathe", 100), 200, 2), option(home("arelate", 100), 200, 1)])!.placeId).toBe("arelate");
    expect(chooseTarget([option(home("arelate", 100), 200, 1), option(home("agathe", 100), 200, 1)])!.placeId).toBe("agathe");
  });
  it("it stays home when it outnumbers the men nowhere", () => {
    expect(chooseTarget([option(home("agathe", 600), 500), option(home("arelate", 100), 40), option(home("rhoda", 100), 100)])).toBeNull();
  });
  it("a raids march on R057's 11th fight brings 400 and picks Agathe (100) over Rhoda (120) and Emporion (250)", () => {
    const r057 = landOf("sordones").find((p) => p.placeId === "R057")!;
    const { force, draws } = raidsForce(r057);
    const targets = raidsTargets(t, homes({ agathe: 100, rhoda: 120, emporion: 250 }), [], "R057");
    const options = targets.map((x) => ({ ...x, force, draws, steps: landStepsBetween(t, ["R057"], x.regionId) }));
    expect(chooseTarget(options)).toMatchObject({ placeId: "agathe", force: 400 });
    expect(aboutMen(force)).toBe(400);
  });
});

describe("the raids count", () => {
  const opts = { fromMs: at(10), restartMs: null, windowMs: raidsWindowMs(c), moreThan: c.raids.moreThan };
  const fights = (n: number, from: number, everyHours: number) => Array.from({ length: n }, (_, i) => at(from) + i * everyHours * HOUR);
  it("the 11th fight within 96 hours fires, the 10th does not", () => {
    expect(raidsFireAt(fights(10, 11, 1), opts)).toBeNull();
    const eleven = fights(11, 11, 1);
    expect(raidsFireAt(eleven, opts)).toBe(eleven[10]);
  });
  it("eleven fights spread over more than 96 hours do not", () => {
    expect(raidsFireAt(fights(11, 11, 10), opts)).toBeNull();
  });
  it("scouts, turn-backs, repulses and stand-downs are no fight", () => {
    expect([marchIsFight("raid", "attacker"), marchIsFight("attack", "defender"), marchIsFight("raid", "stand")]).toEqual([true, true, true]);
    expect([marchIsFight("scout", "attacker"), marchIsFight("raid", "turned_back"), marchIsFight("raid", "repulsed")]).toEqual([false, false, false]);
    expect([musterIsFight("won"), musterIsFight("driven_off"), musterIsFight("turned_back"), musterIsFight("repulsed"), musterIsFight("stood_down")]).toEqual([true, true, false, false, false]);
  });
  it("fights before the strikes went live do not count", () => {
    expect(raidsFireAt([...fights(10, 9, 1), ...fights(1, 10, 1)], opts)).toBeNull();
  });
  it("the count starts again after a raids march's trigger", () => {
    const first = fights(11, 11, 1);
    expect(raidsFireAt([...first, ...fights(10, 12, 1)], { ...opts, restartMs: first[10]! })).toBeNull();
    const more = fights(11, 12, 1);
    expect(raidsFireAt([...first, ...more], { ...opts, restartMs: first[10]! })).toBe(more[10]);
  });
  it("it is off for a nation while it is at war with the League: those fights do not count", () => {
    const wars = [{ factionId: "volcae", startsAt: at(11), endsAt: at(12) }];
    const eleven = fights(11, 11, 1);
    expect(raidsFireAt(fightsAtPeace(eleven, wars, "volcae"), opts)).toBeNull();
    expect(raidsFireAt(fightsAtPeace(eleven, wars, null), opts)).toBe(eleven[10]);
    expect(raidsFireAt(fightsAtPeace(eleven, wars, "saluvii"), opts)).toBe(eleven[10]);
  });
});

describe("the calendar", () => {
  const warn = strikeWarningMs(c);
  it("seasons: 0 Winter, 1 Spring, 3 Autumn, 4 Winter", () => {
    expect([0, 1, 3, 4].map((i) => seasonAt(seasonStartMs(i, T0), T0))).toEqual(["Winter", "Spring", "Autumn", "Winter"]);
  });
  it("a war march is called at the season's start and strikes 12 hours later; never in Winter", () => {
    expect(warCallAt(1, null, warn, T0)).toBe(at(1));
    expect(warCallAt(4, null, warn, T0)).toBeNull();
    // Held up by another march (call 13): called when the road clears, within the season and not striking in Winter.
    expect(warCallAt(1, at(1) + 6 * HOUR, warn, T0)).toBe(at(1) + 6 * HOUR);
    expect(warCallAt(1, at(2) + HOUR, warn, T0)).toBeNull();
    expect(warCallAt(3, at(3) + 13 * HOUR, warn, T0)).toBeNull();
  });
  it("a raids march is called at its fight, or at Spring's start when it or its strike would fall in Winter", () => {
    expect(raidsCallAt(at(2) + HOUR, warn, T0)).toBe(at(2) + HOUR);
    expect(raidsCallAt(at(3) + 13 * HOUR, warn, T0)).toBe(at(5));
    expect(raidsCallAt(at(4) + HOUR, warn, T0)).toBe(at(5));
  });
});

describe("the sums and the words", () => {
  it("a raid that won takes 2 a raider standing, as much as the payer has; a polis loses 2% of its people", () => {
    expect(raidTakes(450, c.plunderPerRaider, 10_000)).toBe(900);
    expect(raidTakes(450, c.plunderPerRaider, 300.7)).toBe(300);
    expect(polisPeopleLost(4000, c.polis.peopleLoss)).toBe(80);
  });
  const volcae = strikeNation({ name: "Volcae", group: "gaulish-peoples" } as never, "Volcae");
  const carthage = strikeNation({ name: "Carthage", group: "major-powers" } as never, "Carthage");
  it("a people takes a plural verb, a major power a singular one; a tribe with no faction is 'the {polity}'", () => {
    expect(strikeLines.march(volcae, "Agathe", 470, "12:00 UTC")).toBe("The Volcae march on Agathe with about 470 men. They strike at 12:00 UTC.");
    expect(strikeLines.march(carthage, "Rhoda", 1200, "12:00 UTC")).toBe("Carthage marches on Rhoda with about 1,200 men. They strike at 12:00 UTC.");
    expect(strikeLines.raidsMarch(strikeNation(null, "Sordones"), "Agathe", 400, "08:30 UTC")).toBe("Raided once too often, the Sordones march on Agathe with about 400 men. They strike at 08:30 UTC.");
    expect(strikeLines.drivenOff(volcae, "Agathe", 120, 35)).toBe("The Volcae struck at Agathe and were driven off. 120 of them fell, and 35 of the defenders.");
    expect(strikeLines.drivenOff(carthage, "Rhoda", 1, 0)).toBe("Carthage struck at Rhoda and was driven off. 1 of them fell, and 0 of the defenders.");
  });
  it("the results, the called-off lines, the ledger row and the house's part", () => {
    expect(strikeLines.brokeIntoHome(volcae, "Agathe", 900, 80)).toBe("The Volcae broke into Agathe. They carried off 900 drachmae from the treasury, and 80 of its people were lost.");
    expect(strikeLines.brokeIntoHome(volcae, "Arelate", 900, null)).toBe("The Volcae broke into Arelate. They carried off 900 drachmae from the treasury.");
    expect(strikeLines.brokeIntoHolding(volcae, "Salyes", 20, "Kleitos")).toBe("The Volcae broke into Salyes and carried off 20 drachmae from House Kleitos.");
    expect(strikeLines.brokeIntoHolding(volcae, "Salyes", 20, null)).toBe("The Volcae broke into Salyes and carried off 20 drachmae from the treasury.");
    expect(strikeLines.stormed(volcae, "Salyes", "Kleitos")).toBe("The Volcae stormed Salyes. House Kleitos has lost it.");
    expect(strikeLines.stormed(volcae, "Salyes", null)).toBe("The Volcae stormed Salyes. The League has lost it.");
    expect(strikeLines.calledOff(volcae, "Agathe", null)).toBe("The Volcae turned back from Agathe.");
    expect(strikeLines.calledOff(volcae, "Agathe", "peace")).toBe("The Volcae turned back from Agathe: peace is made.");
    expect(strikeLines.calledOff(volcae, "Agathe", "war")).toBe("The Volcae turned back from Agathe: they are at war with the League now.");
    expect(strikeLines.calledOff(volcae, "Salyes", "lost")).toBe("The Volcae turned back from Salyes: it is theirs again.");
    expect(strikeLines.ledger(volcae, "Agathe")).toBe("Raid by the Volcae on Agathe");
    expect(strikeLines.yourPart(40, 12)).toBe("40 of your men were among the defenders, and 12 of them fell.");
    expect(strikeLines.title(volcae, "Agathe")).toBe("The Volcae at Agathe");
  });
});
