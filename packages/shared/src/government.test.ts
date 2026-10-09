import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { governmentSeats, leagueTax, parseCitiesContent, parsePoliticsConfig, polisTax, treasuryClaimReason, treasuryReasonLabel, type HeldOffice } from "./index.js";

// ---------------------------------------------------------------------------
// The Government (government prompt 1), pure rules: who sits, what the poleis
// pay, and the words the League ledger shows. The numbers come from content.
// ---------------------------------------------------------------------------

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const politics = parsePoliticsConfig(JSON.parse(readFileSync(resolve(root, "content/politics/politics-config.json"), "utf8")));
const cities = parseCitiesContent(JSON.parse(readFileSync(resolve(root, "content/cities/cities.json"), "utf8")));

describe("governmentSeats", () => {
  it("lists the League seats held, Archon then Ephor then Strategos, and no party office", () => {
    const held: HeldOffice[] = [
      { office: "party_archon", side: "palaioi" },
      { office: "strategos", side: null },
      { office: "party_ephor", side: "dynatoi" },
      { office: "ephor", side: "dynatoi" },
      { office: "archon", side: "palaioi" },
    ];
    expect(governmentSeats(held)).toEqual([
      { office: "archon", side: "palaioi" },
      { office: "ephor", side: "dynatoi" },
      { office: "strategos", side: null },
    ]);
  });

  it("party offices alone are not Government seats", () => {
    expect(governmentSeats([{ office: "party_archon", side: "palaioi" }, { office: "party_ephor", side: "dynatoi" }])).toEqual([]);
    expect(governmentSeats([])).toEqual([]);
  });
});

describe("the polis tax", () => {
  it("taxPerHead is 0.02 and Massalia's 20,000 pay 400 a season", () => {
    expect(politics.treasury.taxPerHead).toBe(0.02);
    expect(polisTax(20_000, politics.treasury)).toBe(400);
  });

  it("rounds per polis and never taxes a negative population", () => {
    expect(polisTax(1_025, politics.treasury)).toBe(21); // 20.5 rounds up
    expect(polisTax(-500, politics.treasury)).toBe(0);
    expect(polisTax(0, politics.treasury)).toBe(0);
  });

  it("the nine start populations pay 910 a season", () => {
    expect(cities.cities).toHaveLength(9);
    expect(leagueTax(cities.cities.map((c) => c.start.population), politics.treasury)).toBe(910);
  });

  it("leagueTax over nothing is 0", () => {
    expect(leagueTax([], politics.treasury)).toBe(0);
  });
});

describe("the ledger's reasons", () => {
  it("the claim reasons carry the season", () => {
    expect(treasuryClaimReason.opening).toBe("opening");
    expect(treasuryClaimReason.tax(7)).toBe("tax:s7");
    expect(treasuryClaimReason.fees(0)).toBe("fees:s0");
    expect(treasuryClaimReason.buildings(3)).toBe("buildings:s3");
  });

  it("every stored reason has its words", () => {
    expect(treasuryReasonLabel("opening")).toBe("Opening balance");
    expect(treasuryReasonLabel("levy:s24")).toBe("Levy");
    expect(treasuryReasonLabel("tax:s24")).toBe("Taxes of the poleis");
    expect(treasuryReasonLabel("fees:s24")).toBe("Market tax and fees");
    expect(treasuryReasonLabel("buildings:s3")).toBe("Bazaar and harbor dues");
    expect(treasuryReasonLabel("cut:seat_purchase")).toBe("Share of a seat sale");
    expect(treasuryReasonLabel("cut:festival_donation")).toBe("Share of a festival gift");
  });

  it("a passed measure names its card when the title is known", () => {
    const titles: Record<string, string> = { "league-sea-wall": "The Sea Wall" };
    expect(treasuryReasonLabel("agenda:league-sea-wall", (id) => titles[id])).toBe("Passed measure: The Sea Wall");
    expect(treasuryReasonLabel("agenda:league-unknown", (id) => titles[id])).toBe("Passed measure");
    expect(treasuryReasonLabel("agenda:league-sea-wall")).toBe("Passed measure");
  });

  it("an unknown reason shows as stored", () => {
    expect(treasuryReasonLabel("seed")).toBe("seed");
    expect(treasuryReasonLabel("dues:s3:4members")).toBe("dues:s3:4members");
  });
});
