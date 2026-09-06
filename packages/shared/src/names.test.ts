import { describe, expect, it } from "vitest";
import { DISPLAY_NAME_MAX, displayNameKey, hasLetter, sanitizeDisplayName } from "./names.js";

describe("sanitizeDisplayName", () => {
  it("trims, collapses whitespace and caps the length", () => {
    expect(sanitizeDisplayName("  Kleitos   of  Massalia ")).toBe("Kleitos of Massalia");
    expect(sanitizeDisplayName("a".repeat(100))).toHaveLength(DISPLAY_NAME_MAX);
    expect(sanitizeDisplayName(42)).toBe("");
    expect(sanitizeDisplayName(undefined)).toBe("");
  });

  it("strips control, zero-width and bidi override characters", () => {
    expect(sanitizeDisplayName("Kle\u0000itos")).toBe("Kleitos"); // NUL
    expect(sanitizeDisplayName("Kle\u200Bitos\u200D")).toBe("Kleitos"); // zero-width space / joiner
    expect(sanitizeDisplayName("\u202EKleitos\u202C")).toBe("Kleitos"); // RLO ... PDF
    expect(sanitizeDisplayName("\u2066Kleitos\u2069")).toBe("Kleitos"); // LRI ... PDI
    expect(sanitizeDisplayName("\uFEFFKleitos")).toBe("Kleitos"); // BOM
    expect(sanitizeDisplayName("Klei\ttos\n")).toBe("Kleitos"); // tabs/newlines are controls, not spaces
    expect(sanitizeDisplayName("\u200B\u200B")).toBe(""); // nothing visible left
  });

  it("keeps letters from any script, diacritics and apostrophes", () => {
    expect(sanitizeDisplayName("\u039E\u03B1\u03BD\u03B8\u03AF\u03C0\u03C0\u03BF\u03C2")).toBe("\u039E\u03B1\u03BD\u03B8\u03AF\u03C0\u03C0\u03BF\u03C2");
    expect(sanitizeDisplayName("\u00C6r\u00F8n O'Neil-S\u00E9gur")).toBe("\u00C6r\u00F8n O'Neil-S\u00E9gur");
  });
});

describe("hasLetter", () => {
  it("requires at least one letter in any script", () => {
    expect(hasLetter("Kleitos")).toBe(true);
    expect(hasLetter("\u039E")).toBe(true);
    expect(hasLetter("1234")).toBe(false);
    expect(hasLetter("--- !!!")).toBe(false);
    expect(hasLetter("")).toBe(false);
  });
});

describe("displayNameKey", () => {
  it("is case-insensitive, matching the database's lower(name) index", () => {
    expect(displayNameKey("Kleitos")).toBe(displayNameKey("KLEITOS"));
    expect(displayNameKey("Kleitos")).not.toBe(displayNameKey("Kleitos II"));
  });
});
