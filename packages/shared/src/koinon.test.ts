import { describe, expect, it } from "vitest";
import { cleanKoinonName, cleanKoinonPost, hallCap, KOINON_EVENTS, parseKoinonContent, settleHall, type HallState, type KoinonContent } from "./koinon.js";

const content: KoinonContent = {
  foundCost: 50,
  foundPrestige: 20,
  memberCap: 8,
  inviteHours: 48,
  cooldownHours: 24,
  absentLeaderDays: 5,
  name: { min: 3, max: 32 },
  post: { maxChars: 300, kept: 20 },
  deposit: { max: 10000 },
  lesche: { cost: 500, buildDays: 2, upkeepPerDay: 5, memberCap: 12 },
};

describe("koinon content", () => {
  it("accepts the shipped shape", () => {
    expect(parseKoinonContent(content)).toEqual(content);
  });

  it("rejects a missing field", () => {
    const { memberCap: _memberCap, ...rest } = content;
    expect(() => parseKoinonContent(rest)).toThrow();
    expect(() => parseKoinonContent({ ...content, post: { maxChars: 300 } })).toThrow();
  });

  it("rejects a number that is not a positive integer", () => {
    expect(() => parseKoinonContent({ ...content, foundCost: 0 })).toThrow();
    expect(() => parseKoinonContent({ ...content, cooldownHours: -1 })).toThrow();
    expect(() => parseKoinonContent({ ...content, inviteHours: 1.5 })).toThrow();
    expect(() => parseKoinonContent({ ...content, name: { min: 0, max: 32 } })).toThrow();
    expect(() => parseKoinonContent({ ...content, absentLeaderDays: "5" })).toThrow();
  });

  it("refuses a lesche.memberCap that is not above memberCap", () => {
    expect(() => parseKoinonContent({ ...content, lesche: { ...content.lesche, memberCap: 8 } })).toThrow(/lesche\.memberCap/);
    expect(() => parseKoinonContent({ ...content, lesche: { ...content.lesche, memberCap: 7 } })).toThrow(/lesche\.memberCap/);
    expect(parseKoinonContent({ ...content, lesche: { ...content.lesche, memberCap: 9 } }).lesche.memberCap).toBe(9);
  });

  it("rejects a missing or non-positive deposit or lesche number", () => {
    const { deposit: _deposit, ...noDeposit } = content;
    expect(() => parseKoinonContent(noDeposit)).toThrow();
    expect(() => parseKoinonContent({ ...content, deposit: { max: 0 } })).toThrow();
    expect(() => parseKoinonContent({ ...content, lesche: { ...content.lesche, upkeepPerDay: 0 } })).toThrow();
    expect(() => parseKoinonContent({ ...content, lesche: { cost: 500, buildDays: 2, memberCap: 12 } })).toThrow();
  });

  it("rejects a name range that runs backwards", () => {
    expect(() => parseKoinonContent({ ...content, name: { min: 33, max: 32 } })).toThrow(/name\.min/);
  });
});

describe("cleanKoinonName", () => {
  it("holds a name to the content's length bounds", () => {
    expect(cleanKoinonName("ab", content)).toBeNull();
    expect(cleanKoinonName("abc", content)).toBe("abc");
    expect(cleanKoinonName("a".repeat(32), content)).toBe("a".repeat(32));
    expect(cleanKoinonName("a".repeat(33), content)).toBeNull();
  });

  it("needs a letter", () => {
    expect(cleanKoinonName("12345", content)).toBeNull();
    expect(cleanKoinonName("300 Spears", content)).toBe("300 Spears");
  });

  it("strips invisible characters before measuring", () => {
    expect(cleanKoinonName("The​ Sacred‮  Band", content)).toBe("The Sacred Band");
    expect(cleanKoinonName("a​b‍", content)).toBeNull(); // two visible characters
    expect(cleanKoinonName(undefined, content)).toBeNull();
  });
});

describe("cleanKoinonPost", () => {
  it("makes one paragraph of the body", () => {
    expect(cleanKoinonPost("  Muster at dawn.\n\nBring\tspears. ", content)).toBe("Muster at dawn. Bring spears.");
    expect(cleanKoinonPost("Mus​ter", content)).toBe("Muster");
  });

  it("refuses a body over the cap, and keeps one at it", () => {
    expect(cleanKoinonPost("a".repeat(300), content)).toBe("a".repeat(300));
    expect(cleanKoinonPost("a".repeat(301), content)).toBeNull();
  });

  it("refuses a body of newlines only, and anything that is not text", () => {
    expect(cleanKoinonPost("\n\n\n", content)).toBeNull();
    expect(cleanKoinonPost("", content)).toBeNull();
    expect(cleanKoinonPost(42, content)).toBeNull();
  });
});

describe("KOINON_EVENTS", () => {
  it("names the six Chronicle events", () => {
    expect([...KOINON_EVENTS]).toEqual(["founded", "joined", "left", "expelled", "leader", "lesche"]);
  });
});

describe("settleHall", () => {
  const DAY = 86_400_000;
  const HOUR = 3_600_000;
  const C = 1_000 * DAY; // the instant the hall stands
  const UPKEEP = 5;
  const standing = (over: Partial<HallState> = {}): HallState => ({ completesAt: C, paidUntil: C, shut: false, treasury: 100, ...over });

  it("no hall, and a hall still building, spend nothing", () => {
    const none: HallState = { completesAt: null, paidUntil: null, shut: false, treasury: 100 };
    expect(settleHall(none, C, UPKEEP)).toEqual({ state: none, spent: 0, open: false, phase: "none" });
    expect(settleHall(standing(), C - 1, UPKEEP)).toEqual({ state: standing(), spent: 0, open: false, phase: "building" });
  });

  it("pays the first day at the exact completion instant", () => {
    expect(settleHall(standing(), C, UPKEEP)).toEqual({ state: standing({ paidUntil: C + DAY, treasury: 95 }), spent: 5, open: true, phase: "open" });
    // Inside a paid day there is nothing to pay.
    expect(settleHall(standing({ paidUntil: C + DAY, treasury: 95 }), C + DAY - 1, UPKEEP)).toMatchObject({ spent: 0, open: true, phase: "open" });
    // A paidUntil never written reads as completesAt.
    expect(settleHall(standing({ paidUntil: null }), C, UPKEEP).state).toEqual(standing({ paidUntil: C + DAY, treasury: 95 }));
  });

  it("3 days unsettled with a full purse pays 4 days", () => {
    expect(settleHall(standing(), C + 3 * DAY, UPKEEP)).toEqual({ state: standing({ paidUntil: C + 4 * DAY, treasury: 80 }), spent: 20, open: true, phase: "open" });
    expect(settleHall(standing(), C + 3 * DAY + HOUR, UPKEEP).spent).toBe(20);
  });

  it("3 days unsettled with 12 in the purse pays 2 days and shuts", () => {
    expect(settleHall(standing({ treasury: 12 }), C + 3 * DAY, UPKEEP)).toEqual({ state: standing({ paidUntil: C + 2 * DAY, shut: true, treasury: 2 }), spent: 10, open: false, phase: "shut" });
  });

  it("a shut hall with 2 stays shut and owes nothing, however long", () => {
    const shut = standing({ paidUntil: C + 2 * DAY, shut: true, treasury: 2 });
    expect(settleHall(shut, C + 3 * DAY, UPKEEP)).toEqual({ state: shut, spent: 0, open: false, phase: "shut" });
    expect(settleHall(shut, C + 300 * DAY, UPKEEP)).toEqual({ state: shut, spent: 0, open: false, phase: "shut" });
  });

  it("a shut hall with 5 reopens with one day paid, a day from now", () => {
    const now = C + 30 * DAY + HOUR;
    expect(settleHall(standing({ paidUntil: C + 2 * DAY, shut: true, treasury: 5 }), now, UPKEEP)).toEqual({ state: standing({ paidUntil: now + DAY, shut: false, treasury: 0 }), spent: 5, open: true, phase: "open" });
  });

  it("is path independent: settling every hour equals settling once, over 10 days with no gifts", () => {
    const start = C - DAY; // a day before the hall stands
    const end = start + 10 * DAY;
    for (const treasury of [0, 4, 5, 12, 37, 45, 50, 1000]) {
      let hourly = standing({ treasury });
      let hourlySpent = 0;
      for (let t = start; t <= end; t += HOUR) {
        const step = settleHall(hourly, t, UPKEEP);
        hourly = step.state;
        hourlySpent += step.spent;
      }
      const once = settleHall(standing({ treasury }), end, UPKEEP);
      expect(hourly, `treasury ${treasury}`).toEqual(once.state);
      expect(hourlySpent, `treasury ${treasury}`).toBe(once.spent);
      expect(once.state.treasury + once.spent).toBe(treasury);
    }
  });

  it("hallCap is the Lesche's cap only while the hall is open", () => {
    expect(hallCap("open", content)).toBe(12);
    for (const phase of ["none", "building", "shut"] as const) expect(hallCap(phase, content)).toBe(8);
  });
});
