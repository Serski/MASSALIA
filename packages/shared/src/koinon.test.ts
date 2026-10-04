import { describe, expect, it } from "vitest";
import { cleanKoinonName, cleanKoinonPost, KOINON_EVENTS, parseKoinonContent, type KoinonContent } from "./koinon.js";

const content: KoinonContent = {
  foundCost: 50,
  foundPrestige: 20,
  memberCap: 8,
  inviteHours: 48,
  cooldownHours: 24,
  absentLeaderDays: 5,
  name: { min: 3, max: 32 },
  post: { maxChars: 300, kept: 20 },
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
  it("names the five Chronicle events", () => {
    expect([...KOINON_EVENTS]).toEqual(["founded", "joined", "left", "expelled", "leader"]);
  });
});
