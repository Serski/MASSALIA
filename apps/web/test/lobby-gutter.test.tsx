// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../src/api.js";
import { GuidesPage } from "../src/lobby/GuidesPage.js";
import { NewsPage } from "../src/lobby/NewsPage.js";

// ---------------------------------------------------------------------------
// The lobby's side gutter. /guides and /news lost theirs when the gutter moved
// off the shell and onto the header, the grid and the footer: their text ran
// from one screen edge to the other on anything narrower than the page itself.
// ---------------------------------------------------------------------------

const never = () => new Promise<never>(() => {});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// jsdom lays nothing out, so the rule is read from the stylesheet itself.
describe("lobby side gutter", () => {
  // The suite runs from apps/web (the gate and CI both use `pnpm --filter`).
  const css = readFileSync(resolve(process.cwd(), "src/lobby/lobby.css"), "utf8");
  // A top-level rule's declarations. The same selectors inside @media are indented and do not match.
  const rule = (name: string) => css.match(new RegExp(`^\\.${name} \\{([^}]*)\\}`, "m"))?.[1] ?? "";
  // In a two- or three-value padding the second value is the left and right side.
  const sidePadding = (name: string) => rule(name).match(/\bpadding: \S+ ([^\s;]+)/)?.[1];
  const maxWidth = (name: string) => rule(name).match(/\bmax-width: ([^;]+);/)?.[1];

  it("gives the header, the grid, the single-column page and the footer one gutter", () => {
    for (const name of ["lobby-header", "lobby-shell-grid", "lobby-page", "lobby-footer"]) {
      expect(sidePadding(name), name).toBe("var(--lobby-gutter)");
    }
  });

  it("keeps the gutter at 16px or more on a phone", () => {
    const floor = rule("lobby-shell").match(/--lobby-gutter: clamp\((\d+)px, [\d.]+vw, \d+px\);/)?.[1];
    expect(Number(floor)).toBeGreaterThanOrEqual(16);
  });

  it("makes the page as wide as the header, centred, with no width of its own to overflow", () => {
    expect(maxWidth("lobby-page")).toBe(maxWidth("lobby-header"));
    expect(rule("lobby-page")).toMatch(/\bmargin: \S+ auto /);
    expect(rule("lobby-page")).not.toMatch(/(?<![-\w])width:/);
  });
});

describe("the single-column lobby pages", () => {
  const PAGE = ".lobby-shell > .lobby-page > .lobby-section";

  it("put /guides inside the page container, under the shell that carries the gutter", () => {
    const { container } = render(<GuidesPage />);
    expect(container.querySelector(PAGE)).not.toBeNull();
  });

  it("put /news inside the page container too", () => {
    vi.spyOn(api, "news").mockImplementation(never);
    const { container } = render(<NewsPage />);
    expect(container.querySelector(PAGE)).not.toBeNull();
  });
});
